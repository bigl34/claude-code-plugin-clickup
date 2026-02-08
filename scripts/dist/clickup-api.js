import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Direct ClickUp API client for operations not well-supported by the MCP server.
 * Currently used for document discovery which requires the v3 docs API.
 */
export class ClickUpDirectAPI {
    apiKey;
    teamId;
    baseUrl = "https://api.clickup.com";
    constructor() {
        const configPath = join(__dirname, "..", "config.json");
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        this.apiKey = config.mcpServer.env.CLICKUP_API_KEY;
        this.teamId = config.teamId;
    }
    async fetch(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: this.apiKey,
                "Content-Type": "application/json",
                ...options.headers,
            },
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`ClickUp API error (${response.status}): ${error}`);
        }
        return response.json();
    }
    /**
     * List all spaces in the workspace
     */
    async listSpaces() {
        const result = await this.fetch(`/api/v2/team/${this.teamId}/space`);
        return result.spaces || [];
    }
    /**
     * Get documents for a specific space using the v3 docs API
     */
    async getDocsForSpace(spaceId) {
        try {
            // The v3 docs API uses parent_id to filter by space
            const result = await this.fetch(`/api/v3/workspaces/${this.teamId}/docs?parent_id=${spaceId}&parent_type=4`);
            return (result.docs || []).map((doc) => ({
                ...doc,
                space_id: spaceId,
            }));
        }
        catch (error) {
            // If this space has no docs or API fails, return empty array
            return [];
        }
    }
    /**
     * Get all documents across all spaces in the workspace
     */
    async getAllDocs() {
        const spaces = await this.listSpaces();
        const allDocs = [];
        for (const space of spaces) {
            const docs = await this.getDocsForSpace(space.id);
            // Add space name to each doc for context
            for (const doc of docs) {
                doc.space_name = space.name;
            }
            allDocs.push(...docs);
        }
        return allDocs;
    }
    /**
     * Search documents by name (case-insensitive)
     */
    async searchDocs(query) {
        const allDocs = await this.getAllDocs();
        const lowerQuery = query.toLowerCase();
        return allDocs.filter((doc) => doc.name.toLowerCase().includes(lowerQuery));
    }
    /**
     * Get task with full description including markdown and URL previews.
     * Uses include_markdown_description=true parameter which the MCP server doesn't support.
     */
    async getTaskWithDescription(taskId) {
        const result = await this.fetch(`/api/v2/task/${taskId}?include_markdown_description=true`);
        return {
            id: result.id,
            name: result.name,
            description: result.description || "",
            markdown_description: result.markdown_description || result.description || "",
            text_content: result.text_content,
            url: result.url || `https://app.clickup.com/t/${taskId}`,
            status: {
                status: result.status?.status || "unknown",
                type: result.status?.type || "unknown",
            },
        };
    }
}
export default ClickUpDirectAPI;
