interface Space {
    id: string;
    name: string;
}
interface Document {
    id: string;
    name: string;
    date_created: string;
    date_updated: string;
    creator?: {
        id: number;
        username: string;
        email: string;
    };
    parent?: {
        id: string;
        type: number;
    };
    space_id?: string;
    space_name?: string;
}
interface TaskDescription {
    id: string;
    name: string;
    description: string;
    markdown_description: string;
    text_content?: string;
    url: string;
    status: {
        status: string;
        type: string;
    };
}
/**
 * Direct ClickUp API client for operations not well-supported by the MCP server.
 * Currently used for document discovery which requires the v3 docs API.
 */
export declare class ClickUpDirectAPI {
    private apiKey;
    private teamId;
    private baseUrl;
    constructor();
    private fetch;
    /**
     * List all spaces in the workspace
     */
    listSpaces(): Promise<Space[]>;
    /**
     * Get documents for a specific space using the v3 docs API
     */
    getDocsForSpace(spaceId: string): Promise<Document[]>;
    /**
     * Get all documents across all spaces in the workspace
     */
    getAllDocs(): Promise<Document[]>;
    /**
     * Search documents by name (case-insensitive)
     */
    searchDocs(query: string): Promise<Document[]>;
    /**
     * Get task with full description including markdown and URL previews.
     * Uses include_markdown_description=true parameter which the MCP server doesn't support.
     */
    getTaskWithDescription(taskId: string): Promise<TaskDescription>;
}
export default ClickUpDirectAPI;
