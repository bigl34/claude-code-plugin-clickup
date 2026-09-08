#!/usr/bin/env npx tsx

import { z, createCommand, runCli, cacheCommands, cliTypes, wrapUntrustedField, buildSafeOutput } from "@local/cli-utils";
import { ClickUpClient } from "./clickup-client.js";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import {
  CurrentSprintResolutionError,
  resolveCurrentSprintList,
  summarizeSprintList,
  type SprintListInput,
  type SprintListSummary,
} from "./sprint-resolver.js";

function parseAssigneeIds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const id = Number(part);
      if (!Number.isInteger(id)) {
        throw new Error(`Invalid assignee ID '${part}' — expected a numeric ClickUp user ID`);
      }
      return id;
    });
}

const createTaskPayloadShape = {
  name: z.string().min(1).describe("Task name"),
  description: z.string().optional().describe("Task description"),
  priority: cliTypes.int(1, 4).optional().describe("Priority (1=urgent, 2=high, 3=normal, 4=low)"),
  status: z.string().optional().describe("Task status"),
  dueDate: cliTypes.int().optional().describe("Due date (Unix timestamp in ms)"),
};

function buildCreateTaskPayload(args: {
  name: string;
  description?: string;
  priority?: number;
  status?: string;
  dueDate?: number;
}): {
  name: string;
  description?: string;
  priority?: number;
  status?: string;
  due_date?: number;
} {
  return {
    name: args.name,
    description: args.description,
    priority: args.priority,
    status: args.status,
    due_date: args.dueDate,
  };
}

function serializeResolutionError(error: CurrentSprintResolutionError) {
  return {
    error: true,
    reason: error.reason,
    message: error.message,
    candidates: error.candidates.map((candidate, index) => wrapSprintListSummary(candidate, `candidates[${index}]`)),
    rejections: error.rejections.map((rejection, index) => ({
      ...rejection,
      list: wrapSprintListSummary(rejection.list, `rejections[${index}].list`),
    })),
  };
}

function wrapMaybeString(field: string, value: unknown, maxChars: number) {
  return typeof value === "string"
    ? wrapUntrustedField(field, value, { maxChars })
    : value;
}

function wrapSprintListSummary(list: SprintListSummary, fieldPrefix = "list") {
  return {
    ...list,
    name: wrapUntrustedField(`${fieldPrefix}.name`, list.name, { maxChars: 500 }),
    folderName: list.folderName === null
      ? null
      : wrapUntrustedField(`${fieldPrefix}.folderName`, list.folderName, { maxChars: 300 }),
    spaceName: list.spaceName === null
      ? null
      : wrapUntrustedField(`${fieldPrefix}.spaceName`, list.spaceName, { maxChars: 300 }),
  };
}

function wrapClickUpList(list: unknown, fieldPrefix = "list") {
  if (!list || typeof list !== "object") return list;
  const record = list as Record<string, unknown>;
  const wrapped = { ...record };
  wrapped.name = wrapMaybeString(`${fieldPrefix}.name`, record.name, 500);
  if (record.folder && typeof record.folder === "object") {
    const folder = record.folder as Record<string, unknown>;
    wrapped.folder = {
      ...folder,
      name: wrapMaybeString(`${fieldPrefix}.folder.name`, folder.name, 300),
    };
  }
  if (record.space && typeof record.space === "object") {
    const space = record.space as Record<string, unknown>;
    wrapped.space = {
      ...space,
      name: wrapMaybeString(`${fieldPrefix}.space.name`, space.name, 300),
    };
  }
  return wrapped;
}

function wrapFolderTask(task: unknown, index: number) {
  const record = task as Record<string, unknown>;
  const status = record.status as Record<string, unknown> | undefined;
  const priority = record.priority as Record<string, unknown> | undefined;
  const list = record.list as Record<string, unknown> | undefined;
  const assignees = Array.isArray(record.assignees)
    ? record.assignees as Array<Record<string, unknown>>
    : [];
  const fieldPrefix = `tasks[${index}]`;

  return {
    task_id: record.id,
    name: wrapMaybeString(`${fieldPrefix}.name`, record.name, 500),
    status: wrapMaybeString(`${fieldPrefix}.status`, status?.status, 200),
    status_type: status?.type,
    priority: priority?.priority ?? null,
    list_id: list?.id,
    list: wrapMaybeString(`${fieldPrefix}.list`, list?.name, 300),
    url: record.url,
    assignees: assignees.map((assignee, assigneeIndex) => ({
      id: assignee.id,
      username: wrapMaybeString(
        `${fieldPrefix}.assignees[${assigneeIndex}].username`,
        assignee.username,
        300,
      ),
      email: wrapMaybeString(
        `${fieldPrefix}.assignees[${assigneeIndex}].email`,
        assignee.email,
        320,
      ),
    })),
  };
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object"
    ? value as UnknownRecord
    : {};
}

function normalizeClickUpTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  const timestamp = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : NaN;

  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function taskMutationParts(task: unknown, fieldPrefix = "task") {
  const record = asRecord(task);
  const status = asRecord(record.status);
  const priority = asRecord(record.priority);
  const list = asRecord(record.list);
  const folder = asRecord(record.folder);
  const space = asRecord(record.space);
  const creator = asRecord(record.creator);
  const assignees = Array.isArray(record.assignees) ? record.assignees : [];
  const tags = Array.isArray(record.tags) ? record.tags : [];

  return {
    metadata: {
      task_id: record.id,
      custom_id: record.custom_id,
      url: record.url,
      status_id: status.id,
      status_type: status.type,
      priority_id: priority.id,
      date_created: normalizeClickUpTimestamp(record.date_created),
      date_updated: normalizeClickUpTimestamp(record.date_updated),
      date_closed: normalizeClickUpTimestamp(record.date_closed),
      date_done: normalizeClickUpTimestamp(record.date_done),
      due_date: normalizeClickUpTimestamp(record.due_date),
      start_date: normalizeClickUpTimestamp(record.start_date),
      list_id: list.id,
      folder_id: folder.id,
      space_id: space.id,
    },
    content: {
      name: wrapMaybeString(`${fieldPrefix}.name`, record.name, 500),
      description: wrapMaybeString(`${fieldPrefix}.description`, record.description, 8000),
      status: wrapMaybeString(`${fieldPrefix}.status`, status.status ?? record.status, 200),
      priority: wrapMaybeString(`${fieldPrefix}.priority`, priority.priority ?? record.priority, 200),
      markdown_description: wrapMaybeString(
        `${fieldPrefix}.markdown_description`,
        record.markdown_description,
        8000,
      ),
      list_name: wrapMaybeString(`${fieldPrefix}.list.name`, list.name, 300),
      folder_name: wrapMaybeString(`${fieldPrefix}.folder.name`, folder.name, 300),
      creator: {
        username: wrapMaybeString(`${fieldPrefix}.creator.username`, creator.username, 300),
        email: wrapMaybeString(`${fieldPrefix}.creator.email`, creator.email, 320),
      },
      assignees: assignees.map((assignee, index) => {
        const assigneeRecord = asRecord(assignee);
        return {
          username: wrapMaybeString(
            `${fieldPrefix}.assignees[${index}].username`,
            assigneeRecord.username,
            300,
          ),
          email: wrapMaybeString(
            `${fieldPrefix}.assignees[${index}].email`,
            assigneeRecord.email,
            320,
          ),
        };
      }),
      tags: tags.map((tag, index) => wrapMaybeString(
        `${fieldPrefix}.tags[${index}].name`,
        asRecord(tag).name,
        200,
      )),
    },
  };
}

function presentTaskMutation(
  command: string,
  task: unknown,
  extraMetadata: UnknownRecord = {},
  extraContent: UnknownRecord = {},
) {
  const presented = taskMutationParts(task);
  return buildSafeOutput(
    { command, ...presented.metadata, ...extraMetadata },
    { task: presented.content, ...extraContent },
  );
}

function presentCommentMutation(command: string, taskId: string, comment: unknown) {
  const record = asRecord(comment);
  const user = asRecord(record.user);
  const assignee = asRecord(record.assignee);
  const assignedBy = asRecord(record.assigned_by);

  return buildSafeOutput(
    {
      command,
      task_id: taskId,
      comment_id: record.id,
      date: normalizeClickUpTimestamp(record.date),
      resolved: record.resolved,
    },
    {
      comment: {
        text: wrapMaybeString("comment.text", record.comment_text, 4000),
        user: {
          username: wrapMaybeString("comment.user.username", user.username, 300),
          email: wrapMaybeString("comment.user.email", user.email, 320),
        },
        assignee: {
          username: wrapMaybeString("comment.assignee.username", assignee.username, 300),
          email: wrapMaybeString("comment.assignee.email", assignee.email, 320),
        },
        assigned_by: {
          username: wrapMaybeString("comment.assigned_by.username", assignedBy.username, 300),
          email: wrapMaybeString("comment.assigned_by.email", assignedBy.email, 320),
        },
      },
    },
  );
}

function presentTimeEntryMutation(command: string, requestedTaskId: string, entry: unknown) {
  const record = asRecord(entry);
  const task = asRecord(record.task);
  const user = asRecord(record.user);
  const parsedDuration = typeof record.duration === "number"
    ? record.duration
    : Number(record.duration);
  const tags = Array.isArray(record.tags) ? record.tags : [];

  return buildSafeOutput(
    {
      command,
      time_entry_id: record.id,
      task_id: task.id ?? requestedTaskId,
      workspace_id: record.wid,
      start: normalizeClickUpTimestamp(record.start),
      end: normalizeClickUpTimestamp(record.end),
      updated_at: normalizeClickUpTimestamp(record.at),
      duration_ms: Number.isFinite(parsedDuration) ? parsedDuration : null,
      billable: record.billable,
    },
    {
      time_entry: {
        description: wrapMaybeString("time_entry.description", record.description, 1000),
        task_name: wrapMaybeString("time_entry.task.name", task.name, 500),
        user: {
          username: wrapMaybeString("time_entry.user.username", user.username, 300),
          email: wrapMaybeString("time_entry.user.email", user.email, 320),
        },
        source: wrapMaybeString("time_entry.source", record.source, 200),
        tags: tags.map((tag, index) => wrapMaybeString(
          `time_entry.tags[${index}]`,
          tag,
          200,
        )),
      },
    },
  );
}

export const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: ClickUpClient) => client.getTools(),
    "List all available commands",
    { sideEffect: "read" }
  ),

  "search": createCommand(
    z.object({
      query: z.string().optional().describe("Search query (fuzzy matching)"),
      list: z.string().optional().describe("Filter by list ID"),
      space: z.string().optional().describe("Filter by space ID"),
      excludeClosed: cliTypes.bool().optional().describe("Exclude closed/done tasks"),
      page: cliTypes.int(0).optional().describe("Results page (0-indexed)"),
      updatedAfter: cliTypes.int(0).optional().describe("Only tasks updated after this Unix timestamp in milliseconds"),
      updatedBefore: cliTypes.int(0).optional().describe("Only tasks updated before this Unix timestamp in milliseconds"),
      orderBy: z.enum(["id", "created", "updated", "due_date"]).optional().describe("Stable provider sort field"),
      reverse: cliTypes.bool().optional().describe("Reverse the provider sort order"),
    }),
    async (args, client: ClickUpClient) => {
      const { query, list, space, excludeClosed, page, updatedAfter, updatedBefore, orderBy, reverse } = args as {
        query?: string;
        list?: string;
        space?: string;
        excludeClosed?: boolean;
        page?: number;
        updatedAfter?: number;
        updatedBefore?: number;
        orderBy?: "id" | "created" | "updated" | "due_date";
        reverse?: boolean;
      };

      const includeClosed = !excludeClosed;

      const result = await client.searchTasks(query || "", {
        include_closed: includeClosed,
        list_ids: list ? [list] : undefined,
        space_ids: space ? [space] : undefined,
        page,
        date_updated_gt: updatedAfter,
        date_updated_lt: updatedBefore,
        order_by: orderBy,
        reverse,
      });

      const wrappedTasks = result.map((task) => {
        const t = task as unknown as Record<string, unknown>;
        return {
          id: t.id,
          status: (t.status as Record<string, unknown>)?.status,
          priority: (t.priority as Record<string, unknown>)?.priority,
          url: t.url,
          date_created: t.date_created ? new Date(parseInt(t.date_created as string, 10)).toISOString() : null,
          date_updated: t.date_updated ? new Date(parseInt(t.date_updated as string, 10)).toISOString() : null,
          due_date: t.due_date ? new Date(parseInt(t.due_date as string)).toISOString() : null,
          assignees: (t.assignees as Array<{ username?: string; email?: string }>)?.map((a) => a.username || a.email),
          name: wrapUntrustedField("tasks[].name", t.name, { maxChars: 500 }),
          list: wrapUntrustedField("tasks[].list", (t.list as Record<string, unknown>)?.name, { maxChars: 200 }),
        };
      });
      return buildSafeOutput(
        { command: "search", count: wrappedTasks.length, page: page ?? 0 },
        { tasks: wrappedTasks },
      );
    },
    "Search for tasks (fuzzy matching)",
    { sideEffect: "read" }
  ),

  "get-task": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
    }),
    async (args, client: ClickUpClient) => {
      const { id } = args as { id: string };
      const task = await client.getTask(id);
      return buildSafeOutput(
        {
          command: "get-task",
          id: task.id,
          status: task.status?.status,
          priority: task.priority?.priority,
          url: task.url,
          points: task.points ?? null,
        },
        {
          name: wrapUntrustedField("name", task.name, { maxChars: 500 }),
          description: wrapUntrustedField("description", task.description ?? "", { maxChars: 8000 }),
        },
      );
    },
    "Get task details by ID",
    { sideEffect: "read" }
  ),

  "get-task-description": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
    }),
    async (args, client: ClickUpClient) => {
      const { id } = args as { id: string };
      const task = await client.getTask(id, true);
      return buildSafeOutput(
        {
          command: "get-task-description",
          id: task.id,
          url: task.url,
          status: task.status?.status,
          date_created: task.date_created ? new Date(parseInt(task.date_created, 10)).toISOString() : null,
          date_updated: task.date_updated ? new Date(parseInt(task.date_updated, 10)).toISOString() : null,
        },
        {
          name: wrapUntrustedField("name", task.name, { maxChars: 500 }),
          description: wrapUntrustedField("description", task.description ?? "", { maxChars: 8000 }),
          markdown_description: wrapUntrustedField(
            "markdown_description",
            task.markdown_description || task.description || "",
            { maxChars: 8000 },
          ),
        },
      );
    },
    "Get task with full markdown description",
    { sideEffect: "read" }
  ),

  "create-task": createCommand(
    z.object({
      list: z.string().min(1).describe("List ID"),
      ...createTaskPayloadShape,
    }),
    async (args, client: ClickUpClient) => {
      const { list, name, description, priority, status, dueDate } = args as {
        list: string;
        name: string;
        description?: string;
        priority?: number;
        status?: string;
        dueDate?: number;
      };
      const task = await client.createTask(
        list,
        buildCreateTaskPayload({ name, description, priority, status, dueDate }),
      );
      return presentTaskMutation("create-task", task, { requested_list_id: list });
    },
    "Create a new task",
    { sideEffect: "write" }
  ),

  "create-sprint-task": createCommand(
    z.object(createTaskPayloadShape),
    async (args, client: ClickUpClient) => {
      const { name, description, priority, status, dueDate } = args as {
        name: string;
        description?: string;
        priority?: number;
        status?: string;
        dueDate?: number;
      };
      try {
        const resolvedList = resolveCurrentSprintList(await client.getAllLists() as SprintListInput[]);
        const task = await client.createTask(
          resolvedList.id,
          buildCreateTaskPayload({ name, description, priority, status: status ?? "to do", dueDate }),
        );
        const output = presentTaskMutation(
          "create-sprint-task",
          task,
          {
            resolved_list_id: resolvedList.id,
            resolved_list_start_date: normalizeClickUpTimestamp(resolvedList.startDateMs),
            resolved_list_due_date: normalizeClickUpTimestamp(resolvedList.dueDateMs),
          },
          {
            resolved_list: {
              name: wrapMaybeString("resolved_list.name", resolvedList.name, 500),
              folder_name: wrapMaybeString("resolved_list.folderName", resolvedList.folderName, 300),
              space_name: wrapMaybeString("resolved_list.spaceName", resolvedList.spaceName, 300),
            },
          },
        );

        return Object.assign(output, {
          task: { id: output.metadata.task_id },
          resolved_list: { id: resolvedList.id },
        });
      } catch (error) {
        if (error instanceof CurrentSprintResolutionError) {
          throw new Error(JSON.stringify(serializeResolutionError(error)));
        }
        throw error;
      }
    },
    "Create a new task in the current User To Dos sprint",
    { sideEffect: "write" }
  ),

  "update-task": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
      name: z.string().optional().describe("New task name"),
      description: z.string().optional().describe("New task description"),
      priority: cliTypes.int(1, 4).optional().describe("Priority (1=urgent, 2=high, 3=normal, 4=low)"),
      status: z.string().optional().describe("New task status"),
      dueDate: cliTypes.int().optional().describe("Due date (Unix timestamp in ms)"),
      list: z.string().optional().describe("Move task to list ID"),
      assigneesAdd: z.string().optional().describe("Comma-separated ClickUp user IDs to assign"),
      assigneesRem: z.string().optional().describe("Comma-separated ClickUp user IDs to unassign"),
      timeEstimate: cliTypes.int(0).optional().describe("Time estimate in milliseconds"),
      points: cliTypes.int(0).optional().describe("Sprint points"),
    }),
    async (args, client: ClickUpClient) => {
      const { id, name, description, priority, status, dueDate, list, assigneesAdd, assigneesRem, timeEstimate, points } = args as {
        id: string;
        name?: string;
        description?: string;
        priority?: number;
        status?: string;
        dueDate?: number;
        list?: string;
        assigneesAdd?: string;
        assigneesRem?: string;
        timeEstimate?: number;
        points?: number;
      };
      const updates: Record<string, unknown> = {};
      if (name) updates.name = name;
      if (description) updates.description = description;
      if (priority) updates.priority = priority;
      if (status) updates.status = status;
      if (dueDate) updates.due_date = dueDate;
      if (list) updates.list_id = list;
      if (timeEstimate !== undefined) updates.time_estimate = timeEstimate;
      if (points !== undefined) updates.points = points;

      const assigneeIdsToAdd = assigneesAdd ? parseAssigneeIds(assigneesAdd) : [];
      const assigneeIdsToRemove = assigneesRem ? parseAssigneeIds(assigneesRem) : [];
      const assigneeChange: { add?: number[]; rem?: number[] } = {};
      if (assigneeIdsToAdd.length > 0) assigneeChange.add = assigneeIdsToAdd;
      if (assigneeIdsToRemove.length > 0) assigneeChange.rem = assigneeIdsToRemove;
      if (assigneeChange.add || assigneeChange.rem) {
        updates.assignees = assigneeChange;
      }

      const task = await client.updateTask(id, updates);
      return presentTaskMutation("update-task", task, { requested_task_id: id });
    },
    "Update a task",
    { sideEffect: "write" }
  ),

  "add-comment": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
      comment: z.string().min(1).describe("Comment text"),
    }),
    async (args, client: ClickUpClient) => {
      const { id, comment } = args as { id: string; comment: string };
      const result = await client.addComment(id, comment);
      return presentCommentMutation("add-comment", id, result);
    },
    "Add a comment to a task",
    { sideEffect: "write" }
  ),

  "get-comments": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
    }),
    async (args, client: ClickUpClient) => {
      const { id } = args as { id: string };
      const comments = await client.getTaskComments(id);
      const wrapped = comments.map((comment) => {
        const c = comment as unknown as Record<string, unknown>;
        return {
          id: c.id,
          user: (c.user as Record<string, unknown>)?.username || (c.user as Record<string, unknown>)?.email,
          date: c.date ? new Date(parseInt(c.date as string)).toISOString() : null,
          text: wrapUntrustedField("comments[].text", c.comment_text, { maxChars: 4000 }),
        };
      });
      return buildSafeOutput(
        { command: "get-comments", task_id: id, count: wrapped.length },
        { comments: wrapped },
      );
    },
    "Get comments on a task",
    { sideEffect: "read" }
  ),

  "search-spaces": createCommand(
    z.object({
      query: z.string().optional().describe("Search query"),
    }),
    async (args, client: ClickUpClient) => {
      const { query } = args as { query?: string };
      const spaces = await client.searchSpaces(query);
      return {
        count: spaces.length,
        spaces: spaces.map((space) => {
          const s = space as unknown as Record<string, unknown>;
          return {
            id: s.id,
            name: wrapMaybeString("spaces[].name", s.name, 500),
            private: s.private,
          };
        }),
      };
    },
    "Search spaces (projects)",
    { sideEffect: "read" }
  ),

  "get-list": createCommand(
    z.object({
      id: z.string().optional().describe("List ID"),
      list: z.string().optional().describe("List ID (alias)"),
    }).refine(
      (data) => data.id !== undefined || data.list !== undefined,
      { message: "Either --id or --list is required" }
    ),
    async (args, client: ClickUpClient) => {
      const { id, list } = args as { id?: string; list?: string };
      return wrapClickUpList(await client.getList(id || list!), "list");
    },
    "Get list details",
    { sideEffect: "read" }
  ),

  "list-lists": createCommand(
    z.object({}),
    async (_args, client: ClickUpClient) => {
      const lists = await client.getAllLists() as SprintListInput[];
      return {
        count: lists.length,
        lists: lists.map((list, index) => wrapSprintListSummary(summarizeSprintList(list), `lists[${index}]`)),
      };
    },
    "List ClickUp lists with IDs and folder/date metadata",
    { sideEffect: "read" }
  ),

  "list-folder-tasks": createCommand(
    z.object({
      folder: z.string().min(1).describe("Folder ID"),
    }),
    async (args, client: ClickUpClient) => {
      const { folder } = args as { folder: string };
      const inventory = await client.getFolderTasks(folder);
      const tasks = inventory.activeTasks.map((task, index) => wrapFolderTask(task, index));

      return buildSafeOutput(
        {
          command: "list-folder-tasks",
          folder_id: inventory.folderId,
          list_count: inventory.listCount,
          total_tasks_returned: inventory.totalTasksReturned,
          active_tasks_checked: tasks.length,
          count: tasks.length,
        },
        { tasks },
      );
    },
    "List all active tasks across every list in a folder for backlog dedupe",
    { sideEffect: "read" }
  ),

  "current-sprint": createCommand(
    z.object({}),
    async (_args, client: ClickUpClient) => {
      try {
        const resolvedList = resolveCurrentSprintList(await client.getAllLists() as SprintListInput[]);
        return {
          resolved_list: wrapSprintListSummary(resolvedList, "resolved_list"),
        };
      } catch (error) {
        if (error instanceof CurrentSprintResolutionError) {
          return serializeResolutionError(error);
        }
        throw error;
      }
    },
    "Resolve the current User To Dos sprint list",
    { sideEffect: "read" }
  ),

  "get-time-entries": createCommand(
    z.object({
      id: z.string().optional().describe("Task ID to filter by"),
    }),
    async (args, client: ClickUpClient) => {
      const { id } = args as { id?: string };
      const entries = await client.getTimeEntries(id ? { task_id: id } : undefined);
      return {
        count: entries.length,
        entries: entries.map((entry) => {
          const e = entry as unknown as Record<string, unknown>;
          return {
            id: e.id,
            task: wrapMaybeString("entries[].task.name", (e.task as Record<string, unknown>)?.name, 500),
            task_id: (e.task as Record<string, unknown>)?.id,
            user: wrapMaybeString(
              "entries[].user",
              (e.user as Record<string, unknown>)?.username || (e.user as Record<string, unknown>)?.email,
              300,
            ),
            duration_ms: e.duration,
            duration_hours: (parseInt(e.duration as string) / 3600000).toFixed(2),
            description: wrapMaybeString("entries[].description", e.description, 1000),
            start: e.start ? new Date(parseInt(e.start as string)).toISOString() : null,
          };
        }),
      };
    },
    "Get time entries",
    { sideEffect: "read" }
  ),

  "create-time-entry": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
      hours: cliTypes.float(0.01).describe("Hours to log"),
      description: z.string().optional().describe("Time entry description"),
    }),
    async (args, client: ClickUpClient) => {
      const { id, hours, description } = args as {
        id: string;
        hours: number;
        description?: string;
      };
      const durationMs = Math.round(hours * 3600000);
      const now = Date.now();

      const entry = await client.createTimeEntry(id, {
        start: now - durationMs,
        duration: durationMs,
        description,
      });
      return presentTimeEntryMutation("create-time-entry", id, entry);
    },
    "Create a time entry",
    { sideEffect: "write" }
  ),

  ...cacheCommands<ClickUpClient>(),
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runCli(commands, ClickUpClient, {
    programName: "clickup-cli",
    description: "ClickUp task management",
  });
}

