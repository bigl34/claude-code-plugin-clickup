#!/usr/bin/env npx tsx
/**
 * ClickUp Task Manager CLI
 *
 * Zod-validated CLI for ClickUp task management.
 */

import { z, createCommand, runCli, cacheCommands, cliTypes } from "@local/cli-utils";
import { ClickUpClient } from "./clickup-client.js";

// Define commands with Zod schemas
const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: ClickUpClient) => client.getTools(),
    "List all available commands"
  ),

  // Task commands
  "search": createCommand(
    z.object({
      query: z.string().optional().describe("Search query (fuzzy matching)"),
      list: z.string().optional().describe("Filter by list ID"),
      space: z.string().optional().describe("Filter by space ID"),
      excludeClosed: cliTypes.bool().optional().describe("Exclude closed/done tasks"),
    }),
    async (args, client: ClickUpClient) => {
      const { query, list, space, excludeClosed } = args as {
        query?: string;
        list?: string;
        space?: string;
        excludeClosed?: boolean;
      };

      const includeClosed = !excludeClosed;

      const result = await client.searchTasks(query || "", {
        include_closed: includeClosed,
        list_ids: list ? [list] : undefined,
        space_ids: space ? [space] : undefined,
      });

      return {
        count: result.length,
        tasks: result.map((t: Record<string, unknown>) => ({
          id: t.id,
          name: t.name,
          status: (t.status as Record<string, unknown>)?.status,
          priority: (t.priority as Record<string, unknown>)?.priority,
          list: (t.list as Record<string, unknown>)?.name,
          url: t.url,
          due_date: t.due_date ? new Date(parseInt(t.due_date as string)).toISOString() : null,
          assignees: (t.assignees as Array<{ username?: string; email?: string }>)?.map((a) => a.username || a.email),
        })),
      };
    },
    "Search for tasks (fuzzy matching)"
  ),

  "get-task": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
    }),
    async (args, client: ClickUpClient) => {
      const { id } = args as { id: string };
      return client.getTask(id);
    },
    "Get task details by ID"
  ),

  "get-task-description": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
    }),
    async (args, client: ClickUpClient) => {
      const { id } = args as { id: string };
      const task = await client.getTask(id, true);
      return {
        id: task.id,
        name: task.name,
        description: task.description || "",
        markdown_description: task.markdown_description || task.description || "",
        url: task.url,
        status: task.status?.status,
      };
    },
    "Get task with full markdown description"
  ),

  "create-task": createCommand(
    z.object({
      list: z.string().min(1).describe("List ID"),
      name: z.string().min(1).describe("Task name"),
      description: z.string().optional().describe("Task description"),
      priority: cliTypes.int(1, 4).optional().describe("Priority (1=urgent, 2=high, 3=normal, 4=low)"),
      status: z.string().optional().describe("Task status"),
      dueDate: cliTypes.int().optional().describe("Due date (Unix timestamp in ms)"),
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
      return client.createTask(list, {
        name,
        description,
        priority,
        status,
        due_date: dueDate,
      });
    },
    "Create a new task"
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
    }),
    async (args, client: ClickUpClient) => {
      const { id, name, description, priority, status, dueDate, list } = args as {
        id: string;
        name?: string;
        description?: string;
        priority?: number;
        status?: string;
        dueDate?: number;
        list?: string;
      };
      const updates: Record<string, unknown> = {};
      if (name) updates.name = name;
      if (description) updates.description = description;
      if (priority) updates.priority = priority;
      if (status) updates.status = status;
      if (dueDate) updates.due_date = dueDate;
      if (list) updates.list_id = list;

      return client.updateTask(id, updates);
    },
    "Update a task"
  ),

  "add-comment": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
      comment: z.string().min(1).describe("Comment text"),
    }),
    async (args, client: ClickUpClient) => {
      const { id, comment } = args as { id: string; comment: string };
      return client.addComment(id, comment);
    },
    "Add a comment to a task"
  ),

  "get-comments": createCommand(
    z.object({
      id: z.string().min(1).describe("Task ID"),
    }),
    async (args, client: ClickUpClient) => {
      const { id } = args as { id: string };
      const comments = await client.getTaskComments(id);
      return {
        count: comments.length,
        comments: comments.map((c: Record<string, unknown>) => ({
          id: c.id,
          text: c.comment_text,
          user: (c.user as Record<string, unknown>)?.username || (c.user as Record<string, unknown>)?.email,
          date: c.date ? new Date(parseInt(c.date as string)).toISOString() : null,
        })),
      };
    },
    "Get comments on a task"
  ),

  // Space/List commands
  "search-spaces": createCommand(
    z.object({
      query: z.string().optional().describe("Search query"),
    }),
    async (args, client: ClickUpClient) => {
      const { query } = args as { query?: string };
      const spaces = await client.searchSpaces(query);
      return {
        count: spaces.length,
        spaces: spaces.map((s: Record<string, unknown>) => ({
          id: s.id,
          name: s.name,
          private: s.private,
        })),
      };
    },
    "Search spaces (projects)"
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
      return client.getList(id || list!);
    },
    "Get list details"
  ),

  // Time tracking commands
  "get-time-entries": createCommand(
    z.object({
      id: z.string().optional().describe("Task ID to filter by"),
    }),
    async (args, client: ClickUpClient) => {
      const { id } = args as { id?: string };
      const entries = await client.getTimeEntries(id ? { task_id: id } : undefined);
      return {
        count: entries.length,
        entries: entries.map((e: Record<string, unknown>) => ({
          id: e.id,
          task: (e.task as Record<string, unknown>)?.name,
          task_id: (e.task as Record<string, unknown>)?.id,
          user: (e.user as Record<string, unknown>)?.username || (e.user as Record<string, unknown>)?.email,
          duration_ms: e.duration,
          duration_hours: (parseInt(e.duration as string) / 3600000).toFixed(2),
          description: e.description,
          start: e.start ? new Date(parseInt(e.start as string)).toISOString() : null,
        })),
      };
    },
    "Get time entries"
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

      return client.createTimeEntry(id, {
        start: now - durationMs,
        duration: durationMs,
        description,
      });
    },
    "Create a time entry"
  ),

  // Pre-built cache commands
  ...cacheCommands<ClickUpClient>(),
};

// Run CLI
runCli(commands, ClickUpClient, {
  programName: "clickup-cli",
  description: "ClickUp task management",
});
