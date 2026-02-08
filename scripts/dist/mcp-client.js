import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ClickUpDirectAPI } from "./clickup-api.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class ClickUpMCPClient {
    client = null;
    transport = null;
    config;
    connected = false;
    directApi;
    constructor() {
        // When compiled, __dirname is dist/, so look in parent for config.json
        const configPath = join(__dirname, "..", "config.json");
        this.config = JSON.parse(readFileSync(configPath, "utf-8"));
        this.directApi = new ClickUpDirectAPI();
    }
    async connect() {
        if (this.connected)
            return;
        const env = {
            ...process.env,
            ...this.config.mcpServer.env,
        };
        this.transport = new StdioClientTransport({
            command: this.config.mcpServer.command,
            args: this.config.mcpServer.args,
            env: env,
            stderr: "ignore", // Suppress MCP server info messages to keep stdout clean JSON
        });
        this.client = new Client({ name: "clickup-cli", version: "1.0.0" }, { capabilities: {} });
        await this.client.connect(this.transport);
        this.connected = true;
    }
    async disconnect() {
        if (this.client && this.connected) {
            this.connected = false;
            // Use a short timeout for close since it tends to hang
            // If it doesn't close cleanly, just exit - we've already got our results
            try {
                await Promise.race([
                    this.client.close(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('close timeout')), 1000))
                ]);
            }
            catch {
                // Timeout or error during close - that's fine, force exit
                process.exit(0);
            }
        }
    }
    async listTools() {
        await this.connect();
        const result = await this.client.listTools();
        return result.tools;
    }
    async callTool(name, args) {
        await this.connect();
        const result = await this.client.callTool({ name, arguments: args });
        const content = result.content;
        if (result.isError) {
            const errorContent = content.find((c) => c.type === "text");
            throw new Error(errorContent?.text || "Tool call failed");
        }
        const textContent = content.find((c) => c.type === "text");
        if (textContent?.text) {
            try {
                return JSON.parse(textContent.text);
            }
            catch {
                return textContent.text;
            }
        }
        return content;
    }
    getTeamId() {
        return this.config.teamId;
    }
    // Task operations
    async getTask(taskId) {
        return this.callTool("getTaskById", { id: taskId, include_markdown_description: true });
    }
    async createTask(listId, task) {
        return this.callTool("createTask", { list_id: listId, ...task });
    }
    async updateTask(taskId, updates) {
        return this.callTool("updateTask", { task_id: taskId, ...updates });
    }
    // Search operations
    async search(query, options) {
        const args = { terms: query ? [query] : [] };
        if (options?.list_ids)
            args.list_ids = options.list_ids;
        if (options?.space_ids)
            args.space_ids = options.space_ids;
        if (options?.assigned_to_me)
            args.assigned_to_me = options.assigned_to_me;
        if (options?.include_closed)
            args.include_closed = options.include_closed;
        return this.callTool("searchTasks", args);
    }
    async searchSpaces(query, spaceId) {
        const args = {};
        if (query)
            args.query = query;
        if (spaceId)
            args.space_id = spaceId;
        return this.callTool("searchSpaces", args);
    }
    // List operations
    async getList(listId) {
        return this.callTool("getListInfo", { list_id: listId });
    }
    async updateListInfo(listId, description) {
        return this.callTool("updateListInfo", { list_id: listId, description });
    }
    // Comment operations
    async addComment(taskId, comment) {
        return this.callTool("addComment", { task_id: taskId, comment });
    }
    async getTaskComments(taskId) {
        // Comments are included in getTaskById response - extract them
        const task = await this.callTool("getTaskById", { id: taskId });
        return { comments: task.comments || [] };
    }
    // Document discovery operations
    // Uses direct ClickUp API for reliable document listing (MCP server returns formatted text, not JSON)
    async getDocsFromWorkspace(workspaceId) {
        const docs = await this.directApi.getAllDocs();
        return { documents: docs };
    }
    async searchDocs(query) {
        const docs = await this.directApi.searchDocs(query);
        return { documents: docs };
    }
    // Time tracking
    async getTimeEntries(taskId) {
        const args = {};
        if (taskId)
            args.task_id = taskId;
        return this.callTool("getTimeEntries", args);
    }
    async createTimeEntry(taskId, hours, description) {
        const args = { task_id: taskId, hours };
        if (description)
            args.description = description;
        return this.callTool("createTimeEntry", args);
    }
    // Task description via direct API (MCP server doesn't support markdown descriptions)
    async getTaskDescription(taskId) {
        return this.directApi.getTaskWithDescription(taskId);
    }
    // Document operations
    async readDocument(docId, pageId) {
        const args = { doc_id: docId };
        if (pageId)
            args.page_id = pageId;
        return this.callTool("readDocument", args);
    }
    async updateDocumentPage(docId, pageId, content, name) {
        const args = { doc_id: docId, page_id: pageId, content };
        if (name)
            args.name = name;
        return this.callTool("updateDocumentPage", args);
    }
    async createDocumentOrPage(options) {
        return this.callTool("createDocumentOrPage", options);
    }
}
export default ClickUpMCPClient;
