const DEFAULT_SPRINT_FOLDER_NAME = "User To Dos";

export type CurrentSprintResolutionReason =
  | "no_current_sprint"
  | "ambiguous_current_sprint";

export type SprintListRejectionReason =
  | "wrong_folder"
  | "missing_dates"
  | "invalid_dates"
  | "outside_date_range";

export interface SprintListInput {
  id: string;
  name: string;
  folderName?: string | null;
  spaceName?: string | null;
  start_date?: string | number | null;
  due_date?: string | number | null;
  task_count?: string | number | null;
}

export interface SprintListSummary {
  id: string;
  name: string;
  folderName: string | null;
  spaceName: string | null;
  startDateMs: number | null;
  dueDateMs: number | null;
  taskCount: number | null;
}

export interface SprintListRejection {
  list: SprintListSummary;
  reason: SprintListRejectionReason;
}

export interface CurrentSprintResolverOptions {
  now?: Date | number;
  sprintFolderName?: string;
}

export class CurrentSprintResolutionError extends Error {
  readonly reason: CurrentSprintResolutionReason;
  readonly candidates: SprintListSummary[];
  readonly rejections: SprintListRejection[];

  constructor(
    reason: CurrentSprintResolutionReason,
    candidates: SprintListSummary[],
    rejections: SprintListRejection[],
  ) {
    super(`${reason}: unable to resolve exactly one current ClickUp sprint list`);
    this.name = "CurrentSprintResolutionError";
    this.reason = reason;
    this.candidates = candidates;
    this.rejections = rejections;
  }
}

function parseEpochMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTaskCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function summarizeSprintList(list: SprintListInput): SprintListSummary {
  return {
    id: list.id,
    name: list.name,
    folderName: list.folderName ?? null,
    spaceName: list.spaceName ?? null,
    startDateMs: parseEpochMs(list.start_date),
    dueDateMs: parseEpochMs(list.due_date),
    taskCount: parseTaskCount(list.task_count),
  };
}

function getNowMs(now: Date | number | undefined): number {
  if (now instanceof Date) {
    return now.getTime();
  }
  return now ?? Date.now();
}

export function resolveCurrentSprintList(
  lists: SprintListInput[],
  options: CurrentSprintResolverOptions = {},
): SprintListSummary {
  const nowMs = getNowMs(options.now);
  const sprintFolderName = options.sprintFolderName ?? DEFAULT_SPRINT_FOLDER_NAME;
  const candidates: SprintListSummary[] = [];
  const rejections: SprintListRejection[] = [];

  for (const list of lists) {
    const summary = summarizeSprintList(list);

    if (summary.folderName !== sprintFolderName) {
      rejections.push({ list: summary, reason: "wrong_folder" });
      continue;
    }

    if (list.start_date === null || list.start_date === undefined || list.due_date === null || list.due_date === undefined) {
      rejections.push({ list: summary, reason: "missing_dates" });
      continue;
    }

    if (summary.startDateMs === null || summary.dueDateMs === null) {
      rejections.push({ list: summary, reason: "invalid_dates" });
      continue;
    }

    if (summary.startDateMs <= nowMs && nowMs <= summary.dueDateMs) {
      candidates.push(summary);
      continue;
    }

    rejections.push({ list: summary, reason: "outside_date_range" });
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  throw new CurrentSprintResolutionError(
    candidates.length === 0 ? "no_current_sprint" : "ambiguous_current_sprint",
    candidates,
    rejections,
  );
}
