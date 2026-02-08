/**
 * ClickUp API Client
 *
 * Direct client for the ClickUp REST API v2.
 * Replaces the MCP server dependency with simple HTTP calls.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Initialize cache with namespace
const cache = new PluginCache({
    namespace: "clickup-task-manager",
    defaultTTL: TTL.FIVE_MINUTES,
});
export class ClickUpClient {
    config;
    baseUrl = "https://api.clickup.com/api/v2";
    cacheDisabled = false;
    constructor() {
        const configPath = join(__dirname, "..", "config.json");
        const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        // Support both formats: { clickup: { apiKey, teamId } } and { mcpServer: { env: { CLICKUP_API_KEY, CLICKUP_TEAM_ID } } }
        let apiKey;
        let teamId;
        if (rawConfig.clickup) {
            // New format
            apiKey = rawConfig.clickup.apiKey;
            teamId = rawConfig.clickup.teamId;
        }
        else if (rawConfig.mcpServer?.env) {
            // Legacy MCP format
            apiKey = rawConfig.mcpServer.env.CLICKUP_API_KEY;
            teamId = rawConfig.mcpServer.env.CLICKUP_TEAM_ID || rawConfig.teamId;
        }
        if (!apiKey || !teamId) {
            throw new Error("Missing required config in config.json: clickup.apiKey, clickup.teamId");
        }
        this.config = { apiKey, teamId };
    }
    // Cache control methods
    disableCache() {
        this.cacheDisabled = true;
        cache.disable();
    }
    enableCache() {
        this.cacheDisabled = false;
        cache.enable();
    }
    getCacheStats() {
        return cache.getStats();
    }
    clearCache() {
        return cache.clear();
    }
    invalidateCacheKey(key) {
        return cache.invalidate(key);
    }
    get teamId() {
        return this.config.teamId;
    }
    async request(method, endpoint, body) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            Authorization: this.config.apiKey,
            "Content-Type": "application/json",
        };
        const options = {
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
        return response.json();
    }
    // ==================== Spaces ==================== (cached - 1 hour)
    async getSpaces() {
        return cache.getOrFetch("spaces", async () => {
            const result = await this.request("GET", `/team/${this.config.teamId}/space`);
            return result.spaces || [];
        }, { ttl: TTL.HOUR, bypassCache: this.cacheDisabled });
    }
    async getSpace(spaceId) {
        const cacheKey = createCacheKey("space", { id: spaceId });
        return cache.getOrFetch(cacheKey, () => this.request("GET", `/space/${spaceId}`), { ttl: TTL.HOUR, bypassCache: this.cacheDisabled });
    }
    // ==================== Folders ==================== (cached - 15 min)
    async getFolders(spaceId) {
        const cacheKey = createCacheKey("folders", { space: spaceId });
        return cache.getOrFetch(cacheKey, async () => {
            const result = await this.request("GET", `/space/${spaceId}/folder`);
            return result.folders || [];
        }, { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled });
    }
    // ==================== Lists ==================== (cached - 15 min)
    async getLists(folderId) {
        const cacheKey = createCacheKey("lists", { folder: folderId });
        return cache.getOrFetch(cacheKey, async () => {
            const result = await this.request("GET", `/folder/${folderId}/list`);
            return result.lists || [];
        }, { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled });
    }
    async getFolderlessLists(spaceId) {
        const cacheKey = createCacheKey("folderless_lists", { space: spaceId });
        return cache.getOrFetch(cacheKey, async () => {
            const result = await this.request("GET", `/space/${spaceId}/list`);
            return result.lists || [];
        }, { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled });
    }
    async getList(listId) {
        const cacheKey = createCacheKey("list", { id: listId });
        return cache.getOrFetch(cacheKey, () => this.request("GET", `/list/${listId}`), { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled });
    }
    // ==================== Tasks ==================== (cached - 5 min for search/list)
    async getTasks(listId, options) {
        // Convert arrays to strings for cache key
        const cacheParams = {
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
        return cache.getOrFetch(cacheKey, async () => {
            const params = new URLSearchParams();
            if (options?.archived !== undefined)
                params.set("archived", String(options.archived));
            if (options?.include_closed)
                params.set("include_closed", "true");
            if (options?.page !== undefined)
                params.set("page", String(options.page));
            if (options?.order_by)
                params.set("order_by", options.order_by);
            if (options?.reverse)
                params.set("reverse", "true");
            if (options?.subtasks)
                params.set("subtasks", "true");
            if (options?.statuses)
                options.statuses.forEach(s => params.append("statuses[]", s));
            if (options?.assignees)
                options.assignees.forEach(a => params.append("assignees[]", a));
            if (options?.due_date_gt)
                params.set("due_date_gt", String(options.due_date_gt));
            if (options?.due_date_lt)
                params.set("due_date_lt", String(options.due_date_lt));
            if (options?.date_created_gt)
                params.set("date_created_gt", String(options.date_created_gt));
            if (options?.date_created_lt)
                params.set("date_created_lt", String(options.date_created_lt));
            if (options?.date_updated_gt)
                params.set("date_updated_gt", String(options.date_updated_gt));
            if (options?.date_updated_lt)
                params.set("date_updated_lt", String(options.date_updated_lt));
            const queryString = params.toString();
            const endpoint = `/list/${listId}/task${queryString ? `?${queryString}` : ""}`;
            const result = await this.request("GET", endpoint);
            return result.tasks || [];
        }, { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled });
    }
    async getTask(taskId, includeMarkdown = false) {
        const cacheKey = createCacheKey("task", { id: taskId, markdown: includeMarkdown });
        return cache.getOrFetch(cacheKey, async () => {
            const params = includeMarkdown ? "?include_markdown_description=true" : "";
            return this.request("GET", `/task/${taskId}${params}`);
        }, { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled });
    }
    async searchTasks(query, options) {
        // Convert arrays to strings for cache key
        const cacheParams = {
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
        return cache.getOrFetch(cacheKey, async () => {
            const params = new URLSearchParams();
            if (query)
                params.set("query", query);
            if (options?.include_closed)
                params.set("include_closed", "true");
            if (options?.page !== undefined)
                params.set("page", String(options.page));
            if (options?.list_ids)
                options.list_ids.forEach(id => params.append("list_ids[]", id));
            if (options?.space_ids)
                options.space_ids.forEach(id => params.append("space_ids[]", id));
            if (options?.folder_ids)
                options.folder_ids.forEach(id => params.append("folder_ids[]", id));
            if (options?.statuses)
                options.statuses.forEach(s => params.append("statuses[]", s));
            const queryString = params.toString();
            const endpoint = `/team/${this.config.teamId}/task${queryString ? `?${queryString}` : ""}`;
            const result = await this.request("GET", endpoint);
            return result.tasks || [];
        }, { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled });
    }
    // Task mutations - NOT cached, invalidate related caches
    async createTask(listId, data) {
        const result = await this.request("POST", `/list/${listId}/task`, data);
        cache.invalidatePattern(/^tasks/);
        cache.invalidatePattern(/^search/);
        return result;
    }
    async updateTask(taskId, data) {
        const result = await this.request("PUT", `/task/${taskId}`, data);
        cache.invalidate(createCacheKey("task", { id: taskId, markdown: false }));
        cache.invalidate(createCacheKey("task", { id: taskId, markdown: true }));
        cache.invalidatePattern(/^tasks/);
        cache.invalidatePattern(/^search/);
        return result;
    }
    async deleteTask(taskId) {
        await this.request("DELETE", `/task/${taskId}`);
        cache.invalidatePattern(/^task/);
        cache.invalidatePattern(/^search/);
    }
    async moveTask(taskId, listId) {
        // Use the dedicated move task endpoint: POST /list/{list_id}/task/{task_id}
        const result = await this.request("POST", `/list/${listId}/task/${taskId}`);
        cache.invalidate(createCacheKey("task", { id: taskId, markdown: false }));
        cache.invalidate(createCacheKey("task", { id: taskId, markdown: true }));
        cache.invalidatePattern(/^tasks/);
        cache.invalidatePattern(/^search/);
        return result;
    }
    // ==================== Comments ==================== (cached - 5 min)
    async getTaskComments(taskId, options) {
        const cacheKey = createCacheKey("comments", { task: taskId, ...options });
        return cache.getOrFetch(cacheKey, async () => {
            const params = new URLSearchParams();
            if (options?.start)
                params.set("start", String(options.start));
            if (options?.start_id)
                params.set("start_id", options.start_id);
            const queryString = params.toString();
            const endpoint = `/task/${taskId}/comment${queryString ? `?${queryString}` : ""}`;
            const result = await this.request("GET", endpoint);
            return result.comments || [];
        }, { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled });
    }
    async addComment(taskId, commentText, notifyAll = false) {
        const result = await this.request("POST", `/task/${taskId}/comment`, {
            comment_text: commentText,
            notify_all: notifyAll,
        });
        cache.invalidatePattern(new RegExp(`^comments.*task=${taskId}`));
        return result;
    }
    // ==================== Time Tracking ==================== (cached - 5 min)
    async getTimeEntries(options) {
        const cacheKey = createCacheKey("time_entries", options || {});
        return cache.getOrFetch(cacheKey, async () => {
            const params = new URLSearchParams();
            if (options?.start_date)
                params.set("start_date", String(options.start_date));
            if (options?.end_date)
                params.set("end_date", String(options.end_date));
            if (options?.assignee)
                params.set("assignee", String(options.assignee));
            if (options?.include_task_tags)
                params.set("include_task_tags", "true");
            if (options?.include_location_names)
                params.set("include_location_names", "true");
            if (options?.space_id)
                params.set("space_id", options.space_id);
            if (options?.folder_id)
                params.set("folder_id", options.folder_id);
            if (options?.list_id)
                params.set("list_id", options.list_id);
            if (options?.task_id)
                params.set("task_id", options.task_id);
            const queryString = params.toString();
            const endpoint = `/team/${this.config.teamId}/time_entries${queryString ? `?${queryString}` : ""}`;
            const result = await this.request("GET", endpoint);
            return result.data || [];
        }, { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled });
    }
    async createTimeEntry(taskId, data) {
        const result = await this.request("POST", `/team/${this.config.teamId}/time_entries`, {
            ...data,
            tid: taskId,
        });
        cache.invalidatePattern(/^time_entries/);
        return result;
    }
    // ==================== Users ==================== (cached - 1 hour)
    async getAuthorizedUser() {
        return cache.getOrFetch("authorized_user", async () => {
            const result = await this.request("GET", "/user");
            return result.user;
        }, { ttl: TTL.HOUR, bypassCache: this.cacheDisabled });
    }
    async getTeamMembers() {
        return cache.getOrFetch("team_members", async () => {
            const result = await this.request("GET", `/team/${this.config.teamId}`);
            return (result.members || []).map(m => m.user);
        }, { ttl: TTL.HOUR, bypassCache: this.cacheDisabled });
    }
    // ==================== Helper Methods ====================
    async searchSpaces(query) {
        const spaces = await this.getSpaces();
        if (!query)
            return spaces;
        const lowerQuery = query.toLowerCase();
        return spaces.filter(s => s.name.toLowerCase().includes(lowerQuery));
    }
    async getAllLists() {
        const spaces = await this.getSpaces();
        const allLists = [];
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
    getTools() {
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
