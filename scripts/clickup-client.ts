/**
 * ClickUp API Client
 *
 * Direct client for the ClickUp REST API v2.
 * Handles workspaces (teams), spaces, folders, lists, and tasks.
 * Configuration from config.json with API key and team ID.
 *
 * Key features:
 * - Full task CRUD operations
 * - Workspace hierarchy navigation (spaces → folders → lists → tasks)
 * - Time tracking entries
 * - Task comments
 * - Flexible search with status/assignee/date filters
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ClickUpConfig {
  apiKey: string;
  teamId: string;
}

interface ConfigFile {
  clickup: {
    apiKey: string;
    teamId: string;
  };
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

// Initialize cache with namespace
const cache = new PluginCache({
  namespace: "clickup-task-manager",
  defaultTTL: TTL.FIVE_MINUTES,
});

export class ClickUpClient {
  private config: ClickUpConfig;
  private baseUrl = "https://api.clickup.com/api/v2";
  private cacheDisabled: boolean = false;

  constructor() {
    const configPath = join(__dirname, "..", "config.json");
    const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

    // Support both formats: { clickup: { apiKey, teamId } } and { mcpServer: { env: { CLICKUP_API_KEY, CLICKUP_TEAM_ID } } }
    let apiKey: string | undefined;
    let teamId: string | undefined;

    if (rawConfig.clickup) {
      // New format
      apiKey = rawConfig.clickup.apiKey;
      teamId = rawConfig.clickup.teamId;
    } else if (rawConfig.mcpServer?.env) {
      // Legacy MCP format
      apiKey = rawConfig.mcpServer.env.CLICKUP_API_KEY;
      teamId = rawConfig.mcpServer.env.CLICKUP_TEAM_ID || rawConfig.teamId;
    }

    if (!apiKey || !teamId) {
      throw new Error(
        "Missing required config in config.json: clickup.apiKey, clickup.teamId"
      );
    }

    this.config = { apiKey, teamId };
  }

  // ============================================
  // CACHE CONTROL
  // ============================================

  /**
   * Disables caching for all subsequent requests.
   * Useful for debugging or when fresh data is required.
   */
  disableCache(): void {
    this.cacheDisabled = true;
    cache.disable();
  }

  /**
   * Re-enables caching after it was disabled.
   */
  enableCache(): void {
    this.cacheDisabled = false;
    cache.enable();
  }

  /**
   * Returns cache statistics including hit/miss counts.
   * @returns Cache stats object with hits, misses, and entry count
   */
  getCacheStats() {
    return cache.getStats();
  }

  /**
   * Clears all cached data.
   * @returns Number of cache entries cleared
   */
  clearCache(): number {
    return cache.clear();
  }

  /**
   * Invalidates a specific cache entry by key.
   * @param key - The cache key to invalidate
   * @returns true if entry was found and removed, false otherwise
   */
  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }

  /**
   * Gets the configured team (workspace) ID.
   * @returns ClickUp team ID from config
   */
  get teamId(): string {
    return this.config.teamId;
  }

  // ============================================
  // HTTP LAYER
  // ============================================

  /**
   * Makes an HTTP request to the ClickUp API.
   *
   * @param method - HTTP method (GET, POST, PUT, DELETE)
   * @param endpoint - API endpoint path
   * @param body - Request body for POST/PUT
   * @returns Parsed JSON response
   * @throws {Error} If API returns non-2xx status
   */
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

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ClickUp API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  // ============================================
  // SPACE OPERATIONS
  // ============================================

  /**
   * Lists all spaces in the workspace.
   *
   * Spaces are the top-level organizational unit in ClickUp.
   *
   * @returns Array of space objects with id, name, statuses, and features
   *
   * @cached TTL: 1 hour
   *
   * @example
   * const spaces = await client.getSpaces();
   * for (const space of spaces) {
   *   console.log(space.name, space.id);
   * }
   */
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

  /**
   * Gets a single space by ID.
   *
   * @param spaceId - ClickUp space ID
   * @returns Space object with full details
   *
   * @cached TTL: 1 hour
   */
  async getSpace(spaceId: string): Promise<Space> {
    const cacheKey = createCacheKey("space", { id: spaceId });
    return cache.getOrFetch(
      cacheKey,
      () => this.request<Space>("GET", `/space/${spaceId}`),
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // FOLDER OPERATIONS
  // ============================================

  /**
   * Lists all folders in a space.
   *
   * Folders are optional organizational containers between spaces and lists.
   *
   * @param spaceId - ClickUp space ID
   * @returns Array of folder objects with lists inside
   *
   * @cached TTL: 15 minutes
   */
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

  // ============================================
  // LIST OPERATIONS
  // ============================================

  /**
   * Lists all lists in a folder.
   *
   * @param folderId - ClickUp folder ID
   * @returns Array of list objects
   *
   * @cached TTL: 15 minutes
   */
  async getLists(folderId: string): Promise<List[]> {
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
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Lists folderless lists directly in a space.
   *
   * Some lists exist directly under a space without being in a folder.
   *
   * @param spaceId - ClickUp space ID
   * @returns Array of list objects not in any folder
   *
   * @cached TTL: 15 minutes
   */
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

  /**
   * Gets a single list by ID.
   *
   * @param listId - ClickUp list ID
   * @returns List object with details and statuses
   *
   * @cached TTL: 15 minutes
   */
  async getList(listId: string): Promise<List> {
    const cacheKey = createCacheKey("list", { id: listId });
    return cache.getOrFetch(
      cacheKey,
      () => this.request<List>("GET", `/list/${listId}`),
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // TASK OPERATIONS
  // ============================================

  /**
   * Lists tasks in a list with optional filtering.
   *
   * Supports extensive filtering by status, assignee, and date ranges.
   * Results are paginated (100 per page).
   *
   * @param listId - ClickUp list ID
   * @param options - Filter options
   * @param options.archived - Include archived tasks
   * @param options.include_closed - Include closed tasks
   * @param options.page - Page number (0-indexed)
   * @param options.order_by - Sort field (e.g., "created", "updated", "due_date")
   * @param options.reverse - Reverse sort order
   * @param options.subtasks - Include subtasks
   * @param options.statuses - Filter by status names
   * @param options.assignees - Filter by assignee user IDs
   * @param options.due_date_gt - Due date after (Unix ms)
   * @param options.due_date_lt - Due date before (Unix ms)
   * @param options.date_created_gt - Created after (Unix ms)
   * @param options.date_created_lt - Created before (Unix ms)
   * @param options.date_updated_gt - Updated after (Unix ms)
   * @param options.date_updated_lt - Updated before (Unix ms)
   * @returns Array of task objects
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * // Get open tasks due this week
   * const tasks = await client.getTasks("list123", {
   *   include_closed: false,
   *   due_date_lt: Date.now() + 7 * 24 * 60 * 60 * 1000
   * });
   */
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
    }
  ): Promise<Task[]> {
    // Convert arrays to strings for cache key
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
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets a single task by ID.
   *
   * @param taskId - ClickUp task ID
   * @param includeMarkdown - Include markdown description (default: false)
   * @returns Task object with full details
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * const task = await client.getTask("abc123", true);
   * console.log(task.name, task.markdown_description);
   */
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

  /**
   * Searches tasks across the workspace.
   *
   * Searches by task name and optionally filters by location and status.
   *
   * @param query - Search query text
   * @param options - Filter options
   * @param options.include_closed - Include closed tasks
   * @param options.assigned_to_me - Only tasks assigned to authenticated user
   * @param options.list_ids - Filter to specific lists
   * @param options.space_ids - Filter to specific spaces
   * @param options.folder_ids - Filter to specific folders
   * @param options.statuses - Filter by status names
   * @param options.page - Page number (0-indexed)
   * @returns Array of matching task objects
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * // Search for shipping-related tasks
   * const tasks = await client.searchTasks("shipping", {
   *   include_closed: false
   * });
   */
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
    }
  ): Promise<Task[]> {
    // Convert arrays to strings for cache key
    const cacheParams: Record<string, string | number | boolean | undefined> = {
      query,
      include_closed: options?.include_closed,
      assigned_to_me: options?.assigned_to_me,
      list_ids: options?.list_ids?.join(","),
      space_ids: options?.space_ids?.join(","),
      folder_ids: options?.folder_ids?.join(","),
      statuses: options?.statuses?.join(","),
      page: options?.page,
    };
    const cacheKey = createCacheKey("search", cacheParams);

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params = new URLSearchParams();

        if (query) params.set("query", query);
        if (options?.include_closed) params.set("include_closed", "true");
        if (options?.page !== undefined) params.set("page", String(options.page));
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

  // ============================================
  // TASK MUTATIONS
  // ============================================

  /**
   * Creates a new task in a list.
   *
   * @param listId - ClickUp list ID
   * @param data - Task data
   * @param data.name - Task name (required)
   * @param data.description - Plain text description
   * @param data.markdown_description - Markdown description
   * @param data.assignees - Array of user IDs to assign
   * @param data.tags - Array of tag names
   * @param data.status - Status name
   * @param data.priority - Priority (1=urgent, 2=high, 3=normal, 4=low)
   * @param data.due_date - Due date (Unix ms)
   * @param data.due_date_time - Whether due date includes time
   * @param data.start_date - Start date (Unix ms)
   * @param data.start_date_time - Whether start date includes time
   * @param data.notify_all - Notify all assignees
   * @param data.parent - Parent task ID for subtasks
   * @param data.links_to - Task ID to link to
   * @param data.check_required_custom_fields - Validate required custom fields
   * @param data.custom_fields - Custom field values
   * @returns Created task object
   *
   * @invalidates tasks/*, search/*
   *
   * @example
   * const task = await client.createTask("list123", {
   *   name: "Review shipping rates",
   *   description: "Compare carrier rates for Q1",
   *   priority: 2,
   *   due_date: Date.now() + 7 * 24 * 60 * 60 * 1000
   * });
   */
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

  /**
   * Updates an existing task.
   *
   * Only provided fields are updated; others remain unchanged.
   *
   * @param taskId - ClickUp task ID
   * @param data - Fields to update
   * @param data.name - New task name
   * @param data.description - Plain text description
   * @param data.markdown_description - Markdown description
   * @param data.assignees - Assignee changes { add: [], rem: [] }
   * @param data.status - New status name
   * @param data.priority - Priority (1=urgent, 2=high, 3=normal, 4=low)
   * @param data.due_date - Due date (Unix ms), null to clear
   * @param data.due_date_time - Whether due date includes time
   * @param data.start_date - Start date (Unix ms)
   * @param data.start_date_time - Whether start date includes time
   * @param data.parent - Parent task ID
   * @param data.time_estimate - Time estimate in ms
   * @param data.archived - Archive/unarchive task
   * @param data.list_id - Move to different list
   * @returns Updated task object
   *
   * @invalidates task/{taskId}, tasks/*, search/*
   *
   * @example
   * // Mark task complete
   * await client.updateTask("abc123", { status: "complete" });
   *
   * @example
   * // Add assignee
   * await client.updateTask("abc123", { assignees: { add: [12345] } });
   */
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

  /**
   * Deletes a task.
   *
   * @param taskId - ClickUp task ID
   *
   * @invalidates task/*, search/*
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.request<{}>("DELETE", `/task/${taskId}`);
    cache.invalidatePattern(/^task/);
    cache.invalidatePattern(/^search/);
  }

  // ============================================
  // COMMENT OPERATIONS
  // ============================================

  /**
   * Gets comments on a task.
   *
   * @param taskId - ClickUp task ID
   * @param options - Pagination options
   * @param options.start - Start timestamp for pagination
   * @param options.start_id - Start comment ID for pagination
   * @returns Array of comment objects
   *
   * @cached TTL: 5 minutes
   */
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

  /**
   * Adds a comment to a task.
   *
   * @param taskId - ClickUp task ID
   * @param commentText - Comment text content
   * @param notifyAll - Notify all task watchers (default: false)
   * @returns Created comment object
   *
   * @invalidates comments/{taskId}
   *
   * @example
   * await client.addComment("abc123", "Shipping labels created", true);
   */
  async addComment(taskId: string, commentText: string, notifyAll = false): Promise<Comment> {
    const result = await this.request<Comment>("POST", `/task/${taskId}/comment`, {
      comment_text: commentText,
      notify_all: notifyAll,
    });
    cache.invalidatePattern(new RegExp(`^comments.*task=${taskId}`));
    return result;
  }

  // ============================================
  // TIME TRACKING OPERATIONS
  // ============================================

  /**
   * Gets time tracking entries.
   *
   * Can be filtered by date range, assignee, or location (space/folder/list/task).
   *
   * @param options - Filter options
   * @param options.start_date - Start of date range (Unix ms)
   * @param options.end_date - End of date range (Unix ms)
   * @param options.assignee - Filter by user ID
   * @param options.include_task_tags - Include task tags in response
   * @param options.include_location_names - Include space/folder/list names
   * @param options.space_id - Filter to specific space
   * @param options.folder_id - Filter to specific folder
   * @param options.list_id - Filter to specific list
   * @param options.task_id - Filter to specific task
   * @returns Array of time entry objects
   *
   * @cached TTL: 5 minutes
   *
   * @example
   * // Get this week's time entries
   * const entries = await client.getTimeEntries({
   *   start_date: weekStart.getTime(),
   *   end_date: Date.now()
   * });
   */
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

  /**
   * Creates a time tracking entry.
   *
   * @param taskId - ClickUp task ID to log time against
   * @param data - Time entry data
   * @param data.start - Start time (Unix ms)
   * @param data.duration - Duration in milliseconds
   * @param data.description - Description of work done
   * @param data.tags - Tag names
   * @param data.billable - Whether time is billable
   * @returns Created time entry object
   *
   * @invalidates time_entries/*
   *
   * @example
   * // Log 2 hours of work
   * await client.createTimeEntry("abc123", {
   *   start: Date.now() - 2 * 60 * 60 * 1000,
   *   duration: 2 * 60 * 60 * 1000,
   *   description: "Shipping integration work"
   * });
   */
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
    const result = await this.request<TimeEntry>(
      "POST",
      `/team/${this.config.teamId}/time_entries`,
      {
        ...data,
        tid: taskId,
      }
    );
    cache.invalidatePattern(/^time_entries/);
    return result;
  }

  // ============================================
  // USER OPERATIONS
  // ============================================

  /**
   * Gets the authenticated user's details.
   *
   * @returns User object for the API key owner
   *
   * @cached TTL: 1 hour
   */
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

  /**
   * Gets all team members in the workspace.
   *
   * @returns Array of user objects
   *
   * @cached TTL: 1 hour
   */
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

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Searches spaces by name.
   *
   * Client-side filtering of getSpaces() results.
   *
   * @param query - Optional search query (case-insensitive)
   * @returns Array of matching spaces
   *
   * @example
   * const spaces = await client.searchSpaces("operations");
   */
  async searchSpaces(query?: string): Promise<Space[]> {
    const spaces = await this.getSpaces();
    if (!query) return spaces;

    const lowerQuery = query.toLowerCase();
    return spaces.filter(s => s.name.toLowerCase().includes(lowerQuery));
  }

  /**
   * Gets all lists across all spaces and folders.
   *
   * Traverses the full workspace hierarchy to collect all lists.
   * Each list includes spaceName and folderName for context.
   *
   * @returns Array of lists with space/folder context
   *
   * @example
   * const lists = await client.getAllLists();
   * for (const list of lists) {
   *   console.log(`${list.spaceName} / ${list.folderName || ''} / ${list.name}`);
   * }
   */
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

  /**
   * Returns list of available CLI commands for this client.
   * Used for CLI help text generation.
   *
   * @returns Array of tool definitions with name and description
   */
  getTools(): Array<{ name: string; description: string }> {
    return [
      { name: "search", description: "Search for tasks by query" },
      { name: "get-task", description: "Get a specific task by ID" },
      { name: "get-task-description", description: "Get task with full markdown description" },
      { name: "create-task", description: "Create a new task in a list" },
      { name: "update-task", description: "Update an existing task" },
      { name: "add-comment", description: "Add a comment to a task" },
      { name: "get-comments", description: "Get comments on a task" },
      { name: "search-spaces", description: "Search/list spaces" },
      { name: "get-list", description: "Get list details" },
      { name: "get-time-entries", description: "Get time tracking entries" },
      { name: "create-time-entry", description: "Log time to a task" },
      { name: "cache-stats", description: "Show cache statistics" },
      { name: "cache-clear", description: "Clear all cached data" },
      { name: "cache-invalidate", description: "Invalidate a specific cache key" },
    ];
  }
}

export default ClickUpClient;
