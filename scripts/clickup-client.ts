
import {
  loadServiceConfig,
  normalizeLegacyMcpConfig,
  z,
} from "@local/cli-utils";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";
import {
  DEFAULT_RETRY_CONFIG,
  calculateBackoff,
  fetchWithRetry,
  isPreSendNetworkError,
  isRetryableError,
  parseRetryAfterMs,
  withRetry,
} from "./vendor/retry/index.js";

const ClickupConfigSchema = z.object({
  clickup: z.object({
    apiKey: z.string().min(1),
    teamId: z.string().min(1),
  }),
});

const RETRYABLE_HTTP_STATUSES = new Set(
  DEFAULT_RETRY_CONFIG.retryableErrors
    .filter((pattern) => /^\d+$/.test(pattern))
    .map((pattern) => Number(pattern))
);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const NON_IDEMPOTENT_RETRYABLE_STATUSES = new Set([429]);
const SINGLE_FETCH_CONFIG = {
  maxRetries: 0,
  retryableErrors: [],
  logger: () => {},
};

const MAX_IN_PROCESS_RATE_LIMIT_WAIT_MS = 30_000;
const EPOCH_MILLISECONDS_THRESHOLD = 1_000_000_000_000;
const HTTP_DATE_PREFIX = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), |(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), |(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) )/i;

export type ClickUpRateLimitResumeSource =
  | "x-rate-limit-reset"
  | "retry-after"
  | "exponential-backoff";

export interface ClickUpRateLimitResumeState {
  source: ClickUpRateLimitResumeSource;
  retryAfterMs: number;
  resumeAtMs: number;
}

export class ClickUpRateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterMs: number;
  readonly resumeState: ClickUpRateLimitResumeState;

  constructor(resumeState: ClickUpRateLimitResumeState) {
    super(
      `ClickUp rate limit: ${resumeState.source} requires another ${Math.ceil(resumeState.retryAfterMs / 1000)}s cooldown, ` +
        `which exceeds the ${MAX_IN_PROCESS_RATE_LIMIT_WAIT_MS / 1000}s in-process wait limit. ` +
        `Resume at or after ${new Date(resumeState.resumeAtMs).toISOString()}.`
    );
    this.name = "ClickUpRateLimitError";
    this.retryAfterMs = resumeState.retryAfterMs;
    this.resumeState = resumeState;
  }
}

function parseRateLimitResetAtMs(value: string | null): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;

  const numericValue = Number(normalized);
  if (!Number.isSafeInteger(numericValue)) return undefined;

  const resetAtMs = numericValue >= EPOCH_MILLISECONDS_THRESHOLD
    ? numericValue
    : numericValue * 1000;
  return Number.isSafeInteger(resetAtMs) && Number.isFinite(new Date(resetAtMs).getTime())
    ? resetAtMs
    : undefined;
}

function parseValidRetryAfterMs(value: string | null, nowMs: number): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  if (!/^\d+$/.test(normalized) && !HTTP_DATE_PREFIX.test(normalized)) {
    return undefined;
  }
  if (/^\d+$/.test(normalized) && !Number.isSafeInteger(Number(normalized))) {
    return undefined;
  }

  const retryAfterMs = parseRetryAfterMs(normalized);
  if (
    retryAfterMs === undefined ||
    !Number.isSafeInteger(retryAfterMs) ||
    !Number.isFinite(new Date(nowMs + retryAfterMs).getTime())
  ) {
    return undefined;
  }
  return retryAfterMs;
}

function rateLimitResumeState(headers: Headers, nowMs = Date.now()): ClickUpRateLimitResumeState | undefined {
  const providerResetAtMs = parseRateLimitResetAtMs(headers.get("x-ratelimit-reset"));
  if (providerResetAtMs !== undefined) {
    return {
      source: "x-rate-limit-reset",
      retryAfterMs: Math.max(0, providerResetAtMs - nowMs),
      resumeAtMs: providerResetAtMs,
    };
  }

  const retryAfterMs = parseValidRetryAfterMs(headers.get("retry-after"), nowMs);
  if (retryAfterMs === undefined) return undefined;
  return {
    source: "retry-after",
    retryAfterMs,
    resumeAtMs: nowMs + retryAfterMs,
  };
}

function isOverBudgetRateLimit(error: unknown): error is ClickUpRateLimitError {
  return error instanceof ClickUpRateLimitError;
}

function retryDelayFromError(error: unknown): number | undefined {
  const candidate = error as {
    status?: number;
    rateLimitResumeState?: ClickUpRateLimitResumeState;
  } | null | undefined;
  return candidate?.status === 429
    ? candidate.rateLimitResumeState?.retryAfterMs
    : undefined;
}

function abortableSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const pending: { timeoutId?: ReturnType<typeof setTimeout> } = {};
    const onAbort = () => {
      if (pending.timeoutId !== undefined) clearTimeout(pending.timeoutId);
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pending.timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}

interface ClickUpConfig {
  apiKey: string;
  teamId: string;
}

interface Space {
  id: string;
  name: string;
  private: boolean;
  statuses: Status[];
  multiple_assignees: boolean;
  features: Record<string, any>;
}

interface Folder {
  id: string;
  name: string;
  orderindex: number;
  hidden: boolean;
  space: { id: string; name: string };
  task_count: string;
  lists: List[];
}

interface List {
  id: string;
  name: string;
  orderindex: number;
  content: string;
  status?: { status: string; color: string; hide_label: boolean };
  priority?: { priority: string; color: string };
  assignee?: User;
  task_count: number;
  due_date?: string;
  start_date?: string;
  folder?: { id: string; name: string; hidden: boolean };
  space?: { id: string; name: string };
  statuses?: Status[];
}

interface Status {
  id?: string;
  status: string;
  type: string;
  orderindex: number;
  color: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  color?: string;
  initials?: string;
  profilePicture?: string;
}

interface Task {
  id: string;
  custom_id?: string;
  name: string;
  text_content?: string;
  description?: string;
  markdown_description?: string;
  status: Status;
  orderindex: string;
  date_created: string;
  date_updated: string;
  date_closed?: string;
  date_done?: string;
  creator: User;
  assignees: User[];
  watchers?: User[];
  checklists?: any[];
  tags: { name: string; tag_fg: string; tag_bg: string }[];
  parent?: string;
  priority?: { id: string; priority: string; color: string; orderindex: string };
  due_date?: string;
  start_date?: string;
  time_estimate?: number;
  time_spent?: number;
  points?: number | null;
  custom_fields?: any[];
  list: { id: string; name: string };
  folder?: { id: string; name: string };
  space: { id: string };
  url: string;
}

interface Comment {
  id: string;
  comment_text: string;
  user: User;
  date: string;
  resolved?: boolean;
  assignee?: User;
  assigned_by?: User;
}

interface TimeEntry {
  id: string;
  task: { id: string; name: string };
  wid: string;
  user: User;
  billable: boolean;
  start: string;
  end?: string;
  duration: string;
  description?: string;
  tags?: string[];
  source?: string;
  at?: string;
}

interface ListResponse<T> {
  data?: T[];
  tasks?: T[];
  spaces?: T[];
  folders?: T[];
  lists?: T[];
  comments?: T[];
}

export interface FolderTaskInventory {
  folderId: string;
  listCount: number;
  totalTasksReturned: number;
  activeTasks: Task[];
}

const CLICKUP_TASK_PAGE_SIZE = 100;
const INACTIVE_TASK_STATUSES = new Set(["done", "closed", "complete", "completed"]);

function isActiveTask(task: Task): boolean {
  const status = task.status?.status?.trim().toLowerCase();
  const statusType = task.status?.type?.trim().toLowerCase();
  return !INACTIVE_TASK_STATUSES.has(status) && !INACTIVE_TASK_STATUSES.has(statusType);
}

const cache = new PluginCache({
  namespace: "clickup-task-manager",
  defaultTTL: TTL.FIVE_MINUTES,
});

export class ClickUpClient {
  private config: ClickUpConfig;
  private baseUrl = "https://api.clickup.com/api/v2";
  private cacheDisabled: boolean = false;

  constructor() {
    const raw = loadServiceConfig("clickup-task-manager");
    const normalized = normalizeLegacyMcpConfig(
      raw,
      {
        "clickup.apiKey": "CLICKUP_API_KEY",
        "clickup.teamId": "CLICKUP_TEAM_ID",
      },
      {
        legacyTopLevel: { "clickup.teamId": "teamId" },
      },
    );
    const config = ClickupConfigSchema.parse(normalized);
    this.config = config.clickup;
  }


  disableCache(): void {
    this.cacheDisabled = true;
    cache.disable();
  }

  enableCache(): void {
    this.cacheDisabled = false;
    cache.enable();
  }

  getCacheStats() {
    return cache.getStats();
  }

  clearCache(): number {
    return cache.clear();
  }

  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }

  get teamId(): string {
    return this.config.teamId;
  }


  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, any>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: this.config.apiKey,
      "Content-Type": "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const isIdempotent = IDEMPOTENT_METHODS.has(method.toUpperCase());
    const retryableStatuses = isIdempotent
      ? RETRYABLE_HTTP_STATUSES
      : NON_IDEMPOTENT_RETRYABLE_STATUSES;
    const response = await this.fetchResponseWithRetry(url, options, retryableStatuses, isIdempotent);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ClickUp API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  private async fetchResponseWithRetry(
    url: string,
    options: RequestInit,
    retryableStatuses: Set<number>,
    idempotent: boolean
  ): Promise<Response> {
    let lastRetryableResponse: Response | undefined;
    let inProcessRateLimitWaitMs = 0;

    const shouldRetryIdempotent = (error: unknown) =>
      !isOverBudgetRateLimit(error) &&
      isRetryableError(error, DEFAULT_RETRY_CONFIG.retryableErrors);
    const shouldRetryNonIdempotent = (error: unknown) =>
      !isOverBudgetRateLimit(error) &&
      ((error as { status?: number })?.status === 429 || isPreSendNetworkError(error));
    const nextDelayMs = ({
      attempt,
      error,
      baseDelayMs,
      maxDelayMs,
    }: {
      attempt: number;
      error: unknown;
      baseDelayMs: number;
      maxDelayMs: number;
    }) => {
      const rateLimitState = (error as {
        status?: number;
        rateLimitResumeState?: ClickUpRateLimitResumeState;
      } | null | undefined)?.rateLimitResumeState;
      const providerDelayMs = retryDelayFromError(error);
      const delayMs = providerDelayMs === undefined || providerDelayMs <= 0
        ? calculateBackoff(attempt, {
            baseDelayMs,
            maxDelayMs,
            jitterPercent: DEFAULT_RETRY_CONFIG.jitterPercent,
          })
        : providerDelayMs;

      if ((error as { status?: number } | null | undefined)?.status === 429) {
        if (inProcessRateLimitWaitMs + delayMs > MAX_IN_PROCESS_RATE_LIMIT_WAIT_MS) {
          throw new ClickUpRateLimitError(
            rateLimitState && providerDelayMs !== undefined && providerDelayMs > 0
              ? rateLimitState
              : {
                  source: "exponential-backoff",
                  retryAfterMs: delayMs,
                  resumeAtMs: Date.now() + delayMs,
                }
          );
        }
        inProcessRateLimitWaitMs += delayMs;
      }

      if (providerDelayMs !== undefined && providerDelayMs > 0) {
        console.error(
          `[clickup] rate limited; honouring ${rateLimitState?.source ?? "provider cooldown"} for ` +
            `${Math.ceil(providerDelayMs / 1000)}s before attempt ${attempt + 2}`
        );
      }
      return delayMs;
    };

    const outerConfig = idempotent
      ? { logger: () => {}, shouldRetry: shouldRetryIdempotent, nextDelayMs, sleepImpl: (ms: number) => abortableSleep(ms, options.signal) }
      : { logger: () => {}, shouldRetry: shouldRetryNonIdempotent, nextDelayMs, sleepImpl: (ms: number) => abortableSleep(ms, options.signal) };

    const result = await withRetry(
      async () => {
        const response = await fetchWithRetry(url, options, SINGLE_FETCH_CONFIG);
        if (!response.ok && retryableStatuses.has(response.status)) {
          lastRetryableResponse = response.clone();

          const resumeState = response.status === 429
            ? rateLimitResumeState(response.headers)
            : undefined;
          if (
            resumeState !== undefined &&
            inProcessRateLimitWaitMs + resumeState.retryAfterMs >
              MAX_IN_PROCESS_RATE_LIMIT_WAIT_MS
          ) {
            throw new ClickUpRateLimitError(resumeState);
          }

          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          (error as Error & { status?: number }).status = response.status;
          if (resumeState !== undefined) {
            (error as Error & {
              rateLimitResumeState?: ClickUpRateLimitResumeState;
            }).rateLimitResumeState = resumeState;
          }
          throw error;
        }
        return response;
      },
      outerConfig
    );

    if (result.success) {
      return result.data as Response;
    }

    if (isOverBudgetRateLimit(result.error)) {
      throw result.error;
    }

    if (lastRetryableResponse) {
      return lastRetryableResponse;
    }

    throw result.error || new Error("ClickUp API request failed after retries");
  }


  async getSpaces(): Promise<Space[]> {
    return cache.getOrFetch(
      "spaces",
      async () => {
        const result = await this.request<{ spaces: Space[] }>(
          "GET",
          `/team/${this.config.teamId}/space`
        );
        return result.spaces || [];
      },
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  async getSpace(spaceId: string): Promise<Space> {
    const cacheKey = createCacheKey("space", { id: spaceId });
    return cache.getOrFetch(
      cacheKey,
      () => this.request<Space>("GET", `/space/${spaceId}`),
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }


  async getFolders(spaceId: string): Promise<Folder[]> {
    const cacheKey = createCacheKey("folders", { space: spaceId });
    return cache.getOrFetch(
      cacheKey,
      async () => {
        const result = await this.request<{ folders: Folder[] }>(
          "GET",
          `/space/${spaceId}/folder`
        );
        return result.folders || [];
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }


  async getLists(
    folderId: string,
    options?: { bypassCache?: boolean }
  ): Promise<List[]> {
    const cacheKey = createCacheKey("lists", { folder: folderId });
    return cache.getOrFetch(
      cacheKey,
      async () => {
        const result = await this.request<{ lists: List[] }>(
          "GET",
          `/folder/${folderId}/list`
        );
        return result.lists || [];
      },
      {
        ttl: TTL.FIFTEEN_MINUTES,
        bypassCache: this.cacheDisabled || options?.bypassCache,
      }
    );
  }

  async getFolderlessLists(spaceId: string): Promise<List[]> {
    const cacheKey = createCacheKey("folderless_lists", { space: spaceId });
    return cache.getOrFetch(
      cacheKey,
      async () => {
        const result = await this.request<{ lists: List[] }>(
          "GET",
          `/space/${spaceId}/list`
        );
        return result.lists || [];
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  async getList(listId: string): Promise<List> {
    const cacheKey = createCacheKey("list", { id: listId });
    return cache.getOrFetch(
      cacheKey,
      () => this.request<List>("GET", `/list/${listId}`),
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }


  async getTasks(
    listId: string,
    options?: {
      archived?: boolean;
      include_closed?: boolean;
      page?: number;
      order_by?: string;
      reverse?: boolean;
      subtasks?: boolean;
      statuses?: string[];
      assignees?: string[];
      due_date_gt?: number;
      due_date_lt?: number;
      date_created_gt?: number;
      date_created_lt?: number;
      date_updated_gt?: number;
      date_updated_lt?: number;
    },
    requestOptions?: { bypassCache?: boolean }
  ): Promise<Task[]> {
    const cacheParams: Record<string, string | number | boolean | undefined> = {
      list: listId,
      archived: options?.archived,
      include_closed: options?.include_closed,
      page: options?.page,
      order_by: options?.order_by,
      reverse: options?.reverse,
      subtasks: options?.subtasks,
      statuses: options?.statuses?.join(","),
      assignees: options?.assignees?.join(","),
      due_date_gt: options?.due_date_gt,
      due_date_lt: options?.due_date_lt,
      date_created_gt: options?.date_created_gt,
      date_created_lt: options?.date_created_lt,
      date_updated_gt: options?.date_updated_gt,
      date_updated_lt: options?.date_updated_lt,
    };
    const cacheKey = createCacheKey("tasks", cacheParams);

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        if (options?.archived !== undefined) params.set("archived", String(options.archived));
        if (options?.include_closed) params.set("include_closed", "true");
        if (options?.page !== undefined) params.set("page", String(options.page));
        if (options?.order_by) params.set("order_by", options.order_by);
        if (options?.reverse) params.set("reverse", "true");
        if (options?.subtasks) params.set("subtasks", "true");
        if (options?.statuses) options.statuses.forEach(s => params.append("statuses[]", s));
        if (options?.assignees) options.assignees.forEach(a => params.append("assignees[]", a));
        if (options?.due_date_gt) params.set("due_date_gt", String(options.due_date_gt));
        if (options?.due_date_lt) params.set("due_date_lt", String(options.due_date_lt));
        if (options?.date_created_gt) params.set("date_created_gt", String(options.date_created_gt));
        if (options?.date_created_lt) params.set("date_created_lt", String(options.date_created_lt));
        if (options?.date_updated_gt) params.set("date_updated_gt", String(options.date_updated_gt));
        if (options?.date_updated_lt) params.set("date_updated_lt", String(options.date_updated_lt));

        const queryString = params.toString();
        const endpoint = `/list/${listId}/task${queryString ? `?${queryString}` : ""}`;

        const result = await this.request<{ tasks: Task[] }>("GET", endpoint);
        return result.tasks || [];
      },
      {
        ttl: TTL.FIVE_MINUTES,
        bypassCache: this.cacheDisabled || requestOptions?.bypassCache,
      }
    );
  }

  async getFolderTasks(folderId: string): Promise<FolderTaskInventory> {
    const lists = await this.getLists(folderId, { bypassCache: true });
    const activeTasks: Task[] = [];
    let totalTasksReturned = 0;

    for (const list of lists) {
      let page = 0;
      let pageTasks: Task[];

      do {
        pageTasks = await this.getTasks(
          list.id,
          {
            archived: false,
            include_closed: false,
            page,
            subtasks: true,
          },
          { bypassCache: true },
        );
        totalTasksReturned += pageTasks.length;
        activeTasks.push(...pageTasks.filter(isActiveTask));
        page++;
      } while (pageTasks.length === CLICKUP_TASK_PAGE_SIZE);
    }

    return {
      folderId,
      listCount: lists.length,
      totalTasksReturned,
      activeTasks,
    };
  }

  async getTask(taskId: string, includeMarkdown = false): Promise<Task> {
    const cacheKey = createCacheKey("task", { id: taskId, markdown: includeMarkdown });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = includeMarkdown ? "?include_markdown_description=true" : "";
        return this.request<Task>("GET", `/task/${taskId}${params}`);
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  async searchTasks(
    query: string,
    options?: {
      include_closed?: boolean;
      assigned_to_me?: boolean;
      list_ids?: string[];
      space_ids?: string[];
      folder_ids?: string[];
      statuses?: string[];
      page?: number;
      date_updated_gt?: number;
      date_updated_lt?: number;
      order_by?: "id" | "created" | "updated" | "due_date";
      reverse?: boolean;
    }
  ): Promise<Task[]> {
    const cacheParams: Record<string, string | number | boolean | undefined> = {
      query,
      include_closed: options?.include_closed,
      assigned_to_me: options?.assigned_to_me,
      list_ids: options?.list_ids?.join(","),
      space_ids: options?.space_ids?.join(","),
      folder_ids: options?.folder_ids?.join(","),
      statuses: options?.statuses?.join(","),
      page: options?.page,
      date_updated_gt: options?.date_updated_gt,
      date_updated_lt: options?.date_updated_lt,
      order_by: options?.order_by,
      reverse: options?.reverse,
    };
    const cacheKey = createCacheKey("search", cacheParams);

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        if (query) params.set("query", query);
        if (options?.include_closed) params.set("include_closed", "true");
        if (options?.page !== undefined) params.set("page", String(options.page));
        if (options?.date_updated_gt !== undefined) params.set("date_updated_gt", String(options.date_updated_gt));
        if (options?.date_updated_lt !== undefined) params.set("date_updated_lt", String(options.date_updated_lt));
        if (options?.order_by !== undefined) params.set("order_by", options.order_by);
        if (options?.reverse !== undefined) params.set("reverse", String(options.reverse));
        if (options?.list_ids) options.list_ids.forEach(id => params.append("list_ids[]", id));
        if (options?.space_ids) options.space_ids.forEach(id => params.append("space_ids[]", id));
        if (options?.folder_ids) options.folder_ids.forEach(id => params.append("folder_ids[]", id));
        if (options?.statuses) options.statuses.forEach(s => params.append("statuses[]", s));

        const queryString = params.toString();
        const endpoint = `/team/${this.config.teamId}/task${queryString ? `?${queryString}` : ""}`;

        const result = await this.request<{ tasks: Task[] }>("GET", endpoint);
        return result.tasks || [];
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }


  async createTask(
    listId: string,
    data: {
      name: string;
      description?: string;
      markdown_description?: string;
      assignees?: number[];
      tags?: string[];
      status?: string;
      priority?: number;
      due_date?: number;
      due_date_time?: boolean;
      start_date?: number;
      start_date_time?: boolean;
      notify_all?: boolean;
      parent?: string;
      links_to?: string;
      check_required_custom_fields?: boolean;
      custom_fields?: { id: string; value: any }[];
    }
  ): Promise<Task> {
    const result = await this.request<Task>("POST", `/list/${listId}/task`, data);
    cache.invalidatePattern(/^tasks/);
    cache.invalidatePattern(/^search/);
    return result;
  }

  async updateTask(
    taskId: string,
    data: {
      name?: string;
      description?: string;
      markdown_description?: string;
      assignees?: { add?: number[]; rem?: number[] };
      status?: string;
      priority?: number;
      due_date?: number;
      due_date_time?: boolean;
      start_date?: number;
      start_date_time?: boolean;
      parent?: string;
      time_estimate?: number;
      points?: number;
      archived?: boolean;
      list_id?: string;
    }
  ): Promise<Task> {
    const result = await this.request<Task>("PUT", `/task/${taskId}`, data);
    cache.invalidate(createCacheKey("task", { id: taskId, markdown: false }));
    cache.invalidate(createCacheKey("task", { id: taskId, markdown: true }));
    cache.invalidatePattern(/^tasks/);
    cache.invalidatePattern(/^search/);
    return result;
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request<{}>("DELETE", `/task/${taskId}`);
    cache.invalidatePattern(/^task/);
    cache.invalidatePattern(/^search/);
  }


  async getTaskComments(taskId: string, options?: { start?: number; start_id?: string }): Promise<Comment[]> {
    const cacheKey = createCacheKey("comments", { task: taskId, ...options });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();
        if (options?.start) params.set("start", String(options.start));
        if (options?.start_id) params.set("start_id", options.start_id);

        const queryString = params.toString();
        const endpoint = `/task/${taskId}/comment${queryString ? `?${queryString}` : ""}`;

        const result = await this.request<{ comments: Comment[] }>("GET", endpoint);
        return result.comments || [];
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  async addComment(taskId: string, commentText: string, notifyAll = false): Promise<Comment> {
    const result = await this.request<Comment>("POST", `/task/${taskId}/comment`, {
      comment_text: commentText,
      notify_all: notifyAll,
    });
    cache.invalidatePattern(new RegExp(`^comments.*task=${taskId}`));
    return result;
  }


  async getTimeEntries(options?: {
    start_date?: number;
    end_date?: number;
    assignee?: number;
    include_task_tags?: boolean;
    include_location_names?: boolean;
    space_id?: string;
    folder_id?: string;
    list_id?: string;
    task_id?: string;
  }): Promise<TimeEntry[]> {
    const cacheKey = createCacheKey("time_entries", options || {});

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        if (options?.start_date) params.set("start_date", String(options.start_date));
        if (options?.end_date) params.set("end_date", String(options.end_date));
        if (options?.assignee) params.set("assignee", String(options.assignee));
        if (options?.include_task_tags) params.set("include_task_tags", "true");
        if (options?.include_location_names) params.set("include_location_names", "true");
        if (options?.space_id) params.set("space_id", options.space_id);
        if (options?.folder_id) params.set("folder_id", options.folder_id);
        if (options?.list_id) params.set("list_id", options.list_id);
        if (options?.task_id) params.set("task_id", options.task_id);

        const queryString = params.toString();
        const endpoint = `/team/${this.config.teamId}/time_entries${queryString ? `?${queryString}` : ""}`;

        const result = await this.request<{ data: TimeEntry[] }>("GET", endpoint);
        return result.data || [];
      },
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  async createTimeEntry(
    taskId: string,
    data: {
      start: number;
      duration: number;
      description?: string;
      tags?: string[];
      billable?: boolean;
    }
  ): Promise<TimeEntry> {
    const result = await this.request<{ data: TimeEntry }>(
      "POST",
      `/team/${this.config.teamId}/time_entries`,
      {
        ...data,
        tid: taskId,
      }
    );
    if (!result?.data) {
      throw new Error("ClickUp create-time-entry response did not contain a data entry");
    }
    cache.invalidatePattern(/^time_entries/);
    return result.data;
  }


  async getAuthorizedUser(): Promise<User> {
    return cache.getOrFetch(
      "authorized_user",
      async () => {
        const result = await this.request<{ user: User }>("GET", "/user");
        return result.user;
      },
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  async getTeamMembers(): Promise<User[]> {
    return cache.getOrFetch(
      "team_members",
      async () => {
        const result = await this.request<{ members: { user: User }[] }>(
          "GET",
          `/team/${this.config.teamId}`
        );
        return (result.members || []).map(m => m.user);
      },
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }


  async searchSpaces(query?: string): Promise<Space[]> {
    const spaces = await this.getSpaces();
    if (!query) return spaces;

    const lowerQuery = query.toLowerCase();
    return spaces.filter(s => s.name.toLowerCase().includes(lowerQuery));
  }

  async getAllLists(): Promise<Array<List & { spaceName?: string; folderName?: string }>> {
    const spaces = await this.getSpaces();
    const allLists: Array<List & { spaceName?: string; folderName?: string }> = [];

    for (const space of spaces) {
      const folderlessLists = await this.getFolderlessLists(space.id);
      for (const list of folderlessLists) {
        allLists.push({ ...list, spaceName: space.name });
      }

      const folders = await this.getFolders(space.id);
      for (const folder of folders) {
        const lists = await this.getLists(folder.id);
        for (const list of lists) {
          allLists.push({ ...list, spaceName: space.name, folderName: folder.name });
        }
      }
    }

    return allLists;
  }

  getTools(): Array<{ name: string; description: string }> {
    return [
      { name: "search", description: "Search for tasks by query" },
      { name: "get-task", description: "Get a specific task by ID" },
      { name: "get-task-description", description: "Get task with full markdown description" },
      { name: "create-task", description: "Create a new task in a list" },
      { name: "create-sprint-task", description: "Create a new task in the current User To Dos sprint" },
      { name: "update-task", description: "Update an existing task" },
      { name: "add-comment", description: "Add a comment to a task" },
      { name: "get-comments", description: "Get comments on a task" },
      { name: "search-spaces", description: "Search/list spaces" },
      { name: "get-list", description: "Get list details" },
      { name: "list-lists", description: "List ClickUp lists with IDs and folder/date metadata" },
      { name: "list-folder-tasks", description: "List all active tasks across every list in a folder" },
      { name: "current-sprint", description: "Resolve the current User To Dos sprint list" },
      { name: "get-time-entries", description: "Get time tracking entries" },
      { name: "create-time-entry", description: "Log time to a task" },
      { name: "cache-stats", description: "Show cache statistics" },
      { name: "cache-clear", description: "Clear all cached data" },
      { name: "cache-invalidate", description: "Invalidate a specific cache key" },
    ];
  }
}

export default ClickUpClient;
