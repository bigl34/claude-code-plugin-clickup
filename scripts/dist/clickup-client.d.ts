/**
 * ClickUp API Client
 *
 * Direct client for the ClickUp REST API v2.
 * Replaces the MCP server dependency with simple HTTP calls.
 */
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
    space: {
        id: string;
        name: string;
    };
    task_count: string;
    lists: List[];
}
interface List {
    id: string;
    name: string;
    orderindex: number;
    content: string;
    status?: {
        status: string;
        color: string;
        hide_label: boolean;
    };
    priority?: {
        priority: string;
        color: string;
    };
    assignee?: User;
    task_count: number;
    due_date?: string;
    start_date?: string;
    folder?: {
        id: string;
        name: string;
        hidden: boolean;
    };
    space?: {
        id: string;
        name: string;
    };
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
    tags: {
        name: string;
        tag_fg: string;
        tag_bg: string;
    }[];
    parent?: string;
    priority?: {
        id: string;
        priority: string;
        color: string;
        orderindex: string;
    };
    due_date?: string;
    start_date?: string;
    time_estimate?: number;
    time_spent?: number;
    custom_fields?: any[];
    list: {
        id: string;
        name: string;
    };
    folder?: {
        id: string;
        name: string;
    };
    space: {
        id: string;
    };
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
    task: {
        id: string;
        name: string;
    };
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
export declare class ClickUpClient {
    private config;
    private baseUrl;
    private cacheDisabled;
    constructor();
    disableCache(): void;
    enableCache(): void;
    getCacheStats(): import("@local/plugin-cache").CacheStats;
    clearCache(): number;
    invalidateCacheKey(key: string): boolean;
    get teamId(): string;
    private request;
    getSpaces(): Promise<Space[]>;
    getSpace(spaceId: string): Promise<Space>;
    getFolders(spaceId: string): Promise<Folder[]>;
    getLists(folderId: string): Promise<List[]>;
    getFolderlessLists(spaceId: string): Promise<List[]>;
    getList(listId: string): Promise<List>;
    getTasks(listId: string, options?: {
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
    }): Promise<Task[]>;
    getTask(taskId: string, includeMarkdown?: boolean): Promise<Task>;
    searchTasks(query: string, options?: {
        include_closed?: boolean;
        assigned_to_me?: boolean;
        list_ids?: string[];
        space_ids?: string[];
        folder_ids?: string[];
        statuses?: string[];
        page?: number;
    }): Promise<Task[]>;
    createTask(listId: string, data: {
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
        custom_fields?: {
            id: string;
            value: any;
        }[];
    }): Promise<Task>;
    updateTask(taskId: string, data: {
        name?: string;
        description?: string;
        markdown_description?: string;
        assignees?: {
            add?: number[];
            rem?: number[];
        };
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
    }): Promise<Task>;
    deleteTask(taskId: string): Promise<void>;
    moveTask(taskId: string, listId: string): Promise<Task>;
    getTaskComments(taskId: string, options?: {
        start?: number;
        start_id?: string;
    }): Promise<Comment[]>;
    addComment(taskId: string, commentText: string, notifyAll?: boolean): Promise<Comment>;
    getTimeEntries(options?: {
        start_date?: number;
        end_date?: number;
        assignee?: number;
        include_task_tags?: boolean;
        include_location_names?: boolean;
        space_id?: string;
        folder_id?: string;
        list_id?: string;
        task_id?: string;
    }): Promise<TimeEntry[]>;
    createTimeEntry(taskId: string, data: {
        start: number;
        duration: number;
        description?: string;
        tags?: string[];
        billable?: boolean;
    }): Promise<TimeEntry>;
    getAuthorizedUser(): Promise<User>;
    getTeamMembers(): Promise<User[]>;
    searchSpaces(query?: string): Promise<Space[]>;
    getAllLists(): Promise<Array<List & {
        spaceName?: string;
        folderName?: string;
    }>>;
    getTools(): Array<{
        name: string;
        description: string;
    }>;
}
export default ClickUpClient;
