export declare class ClickUpMCPClient {
    private client;
    private transport;
    private config;
    private connected;
    private directApi;
    constructor();
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    listTools(): Promise<any[]>;
    callTool(name: string, args: Record<string, any>): Promise<any>;
    getTeamId(): string;
    getTask(taskId: string): Promise<any>;
    createTask(listId: string, task: {
        name: string;
        description?: string;
        assignees?: string[];
        priority?: number;
        due_date?: number;
        status?: string;
        tags?: string[];
    }): Promise<any>;
    updateTask(taskId: string, updates: {
        name?: string;
        description?: string;
        priority?: number;
        due_date?: number;
        status?: string;
    }): Promise<any>;
    search(query: string, options?: {
        list_ids?: string[];
        space_ids?: string[];
        assigned_to_me?: boolean;
        include_closed?: boolean;
    }): Promise<any>;
    searchSpaces(query?: string, spaceId?: string): Promise<any>;
    getList(listId: string): Promise<any>;
    updateListInfo(listId: string, description: string): Promise<any>;
    addComment(taskId: string, comment: string): Promise<any>;
    getTaskComments(taskId: string): Promise<any>;
    getDocsFromWorkspace(workspaceId?: string): Promise<any>;
    searchDocs(query: string): Promise<any>;
    getTimeEntries(taskId?: string): Promise<any>;
    createTimeEntry(taskId: string, hours: number, description?: string): Promise<any>;
    getTaskDescription(taskId: string): Promise<any>;
    readDocument(docId: string, pageId?: string): Promise<any>;
    updateDocumentPage(docId: string, pageId: string, content: string, name?: string): Promise<any>;
    createDocumentOrPage(options: {
        space_id?: string;
        list_id?: string;
        doc_id?: string;
        parent_page_id?: string;
        name: string;
        content: string;
    }): Promise<any>;
}
export default ClickUpMCPClient;
