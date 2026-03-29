/**
 * api-client.ts - Typed HTTP client for Myrlin server API calls.
 *
 * Provides a MyrlinAPIClient class that handles Bearer token auth,
 * JSON serialization, and typed responses for all server endpoints.
 * Throws APIError on non-OK HTTP statuses for consistent error handling.
 *
 * The pair() method intentionally omits the Authorization header since
 * pairing tokens are exchanged before the client has a Bearer token.
 */

import {
  type AuthCheckResponse,
  type LoginResponse,
  type PairResponse,
  type Session,
  type SessionCost,
  type Workspace,
  type WorkspaceGroup,
  type SessionTemplate,
  type FileConflict,
  type CreateSessionInput,
  type SearchResult,
  type Subagent,
  type ResourceMetrics,
  type WorkspaceDocs,
  type DocSection,
  type Feature,
  type WorktreeTask,
  type CreateTaskInput,
  type TaskPR,
  type TaskChanges,
  type CostPeriod,
  type CostDashboardResponse,
  type PushRegisterInput,
  APIError,
} from '../types/api';

/**
 * Typed HTTP client for communicating with a Myrlin Workbook server.
 *
 * Handles auth headers, JSON encoding, and error normalization.
 * Each instance is bound to a specific server URL and Bearer token.
 *
 * @example
 * ```ts
 * const client = createAPIClient('http://192.168.1.50:3456', myToken);
 * const result = await client.checkAuth();
 * ```
 */
export class MyrlinAPIClient {
  /** Base URL of the Myrlin server (no trailing slash) */
  private baseUrl: string;
  /** Bearer token for authenticated requests */
  private token: string;

  /**
   * Create a new API client for a specific server.
   * @param baseUrl - Server URL (e.g. "http://192.168.1.50:3456")
   * @param token - Bearer auth token from login or pairing
   */
  constructor(baseUrl: string, token: string) {
    // Strip trailing slash for consistent URL building
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  /**
   * Internal fetch wrapper with auth headers and error handling.
   * Prepends baseUrl, adds Authorization and Content-Type headers,
   * and throws APIError on non-OK responses.
   *
   * @param path - API path (e.g. "/api/auth/check")
   * @param options - Fetch options (method, body, headers, etc.)
   * @returns Parsed JSON response
   * @throws APIError if the HTTP response is not OK
   */
  private async _fetch<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = this.baseUrl + path;
    const method = (options.method || 'GET').toUpperCase();

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    // Add auth header unless explicitly omitted
    if (!('Authorization' in headers)) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Add JSON content type for request bodies
    if (['POST', 'PUT', 'PATCH'].includes(method) && options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      method,
      headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new APIError(
        `API request failed: ${method} ${path} returned ${response.status}`,
        response.status,
        body
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check if the current Bearer token is still valid.
   * @returns Authentication status
   */
  async checkAuth(): Promise<AuthCheckResponse> {
    return this._fetch<AuthCheckResponse>('/api/auth/check');
  }

  /**
   * Authenticate with a password to get a Bearer token.
   * @param password - Server password
   * @returns Login result with token on success, error on failure
   */
  async login(password: string): Promise<LoginResponse> {
    return this._fetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
      // Login does not need Bearer auth
      headers: { Authorization: '' },
    });
  }

  /**
   * Invalidate the current Bearer token.
   * @returns Success status
   */
  async logout(): Promise<{ success: boolean }> {
    return this._fetch<{ success: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
  }

  /**
   * Exchange a pairing token for a long-lived Bearer token.
   * This endpoint is public (no auth required), so the Authorization
   * header is explicitly omitted.
   *
   * @param pairingToken - Short-lived token from QR code scan
   * @param deviceName - Display name for this mobile device
   * @param platform - Device platform ("ios" or "android")
   * @returns Pair result with Bearer token and server info
   */
  async pair(
    pairingToken: string,
    deviceName: string,
    platform: string
  ): Promise<PairResponse> {
    return this._fetch<PairResponse>('/api/auth/pair', {
      method: 'POST',
      body: JSON.stringify({ pairingToken, deviceName, platform }),
      // Pairing is pre-auth; omit Bearer header
      headers: { Authorization: '' },
    });
  }

  // ─── Sessions ───────────────────────────────────────────

  /**
   * Fetch sessions from the server with optional mode and filters.
   * @param mode - View mode: "all", "workspace", or "recent"
   * @param params - Optional filters (workspaceId for workspace mode, count for recent)
   * @returns Sessions list and optional recent sessions
   */
  async getSessions(
    mode: 'all' | 'workspace' | 'recent' = 'all',
    params?: { workspaceId?: string; count?: number }
  ): Promise<{ sessions: Session[]; recentSessions?: Session[] }> {
    const query = new URLSearchParams({ mode });
    if (params?.workspaceId) query.set('workspaceId', params.workspaceId);
    if (params?.count) query.set('count', String(params.count));
    return this._fetch(`/api/sessions?${query.toString()}`);
  }

  /**
   * Fetch a single session by ID.
   * The server returns all sessions; this filters client-side.
   * @param id - Session ID to find
   * @returns The matching session
   */
  async getSession(id: string): Promise<Session | undefined> {
    const { sessions } = await this.getSessions();
    return sessions.find((s) => s.id === id);
  }

  /**
   * Create a new session on the server.
   * @param data - Session creation parameters
   * @returns The newly created session
   */
  async createSession(data: CreateSessionInput): Promise<{ session: Session }> {
    return this._fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing session (rename, move, tag, etc.).
   * @param id - Session ID to update
   * @param data - Partial session fields to update
   * @returns The updated session
   */
  async updateSession(
    id: string,
    data: Partial<Session>
  ): Promise<{ session: Session }> {
    return this._fetch(`/api/sessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete (hide) a session.
   * @param id - Session ID to delete
   * @returns Success indicator
   */
  async deleteSession(id: string): Promise<{ success: boolean }> {
    return this._fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  }

  /**
   * Start a stopped session.
   * @param id - Session ID to start
   * @returns Success indicator and new PID
   */
  async startSession(id: string): Promise<{ success: boolean; pid: number }> {
    return this._fetch(`/api/sessions/${id}/start`, { method: 'POST' });
  }

  /**
   * Stop a running session.
   * @param id - Session ID to stop
   * @returns Success indicator
   */
  async stopSession(id: string): Promise<{ success: boolean }> {
    return this._fetch(`/api/sessions/${id}/stop`, { method: 'POST' });
  }

  /**
   * Restart a session (stop then start).
   * @param id - Session ID to restart
   * @returns Success indicator and new PID
   */
  async restartSession(
    id: string
  ): Promise<{ success: boolean; pid: number }> {
    return this._fetch(`/api/sessions/${id}/restart`, { method: 'POST' });
  }

  /**
   * Get cost breakdown for a session from JSONL usage data.
   * @param id - Session ID
   * @returns Cost breakdown by category and model
   */
  async getSessionCost(id: string): Promise<SessionCost> {
    return this._fetch(`/api/sessions/${id}/cost`);
  }

  /**
   * Fetch the cost dashboard with aggregated metrics, timeline, and breakdowns.
   * @param period - Time period filter (day, week, month, all)
   * @returns Full cost dashboard response with summary, timeline, and breakdowns
   */
  async getCostDashboard(period: CostPeriod): Promise<CostDashboardResponse> {
    return this._fetch(`/api/cost/dashboard?period=${period}`);
  }

  /**
   * Get subagent tree for a session.
   * @param id - Session ID
   * @returns List of subagents
   */
  async getSessionSubagents(
    id: string
  ): Promise<{ subagents: Subagent[] }> {
    return this._fetch(`/api/sessions/${id}/subagents`);
  }

  /**
   * Generate an AI-powered title for a session.
   * @param id - Session ID
   * @returns Generated title string
   */
  async autoTitle(id: string): Promise<{ title: string }> {
    return this._fetch(`/api/sessions/${id}/auto-title`, { method: 'POST' });
  }

  /**
   * Generate an AI-powered summary of a session.
   * @param id - Session ID
   * @returns Generated summary string
   */
  async summarize(id: string): Promise<{ summary: string }> {
    return this._fetch(`/api/sessions/${id}/summarize`, { method: 'POST' });
  }

  // ─── Workspaces ─────────────────────────────────────────

  /**
   * Fetch all workspaces and their ordering.
   * @returns Workspaces list and workspace order array
   */
  async getWorkspaces(): Promise<{
    workspaces: Workspace[];
    workspaceOrder: string[];
  }> {
    return this._fetch('/api/workspaces');
  }

  /**
   * Fetch a single workspace by ID with its sessions.
   * @param id - Workspace ID
   * @returns The workspace
   */
  async getWorkspace(id: string): Promise<{ workspace: Workspace }> {
    return this._fetch(`/api/workspaces/${id}`);
  }

  /**
   * Create a new workspace.
   * @param data - Workspace name, optional description and color
   * @returns The created workspace
   */
  async createWorkspace(data: {
    name: string;
    description?: string;
    color?: string;
  }): Promise<{ workspace: Workspace }> {
    return this._fetch('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing workspace.
   * @param id - Workspace ID
   * @param data - Partial workspace fields to update
   * @returns The updated workspace
   */
  async updateWorkspace(
    id: string,
    data: Partial<Workspace>
  ): Promise<{ workspace: Workspace }> {
    return this._fetch(`/api/workspaces/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a workspace.
   * @param id - Workspace ID
   * @returns Success indicator
   */
  async deleteWorkspace(id: string): Promise<{ success: boolean }> {
    return this._fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
  }

  /**
   * Reorder workspaces by providing the full ordering.
   * @param order - Ordered array of workspace IDs
   * @returns Success indicator
   */
  async reorderWorkspaces(
    order: string[]
  ): Promise<{ success: boolean }> {
    return this._fetch('/api/workspaces/reorder', {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
  }

  // ─── Groups ─────────────────────────────────────────────

  /**
   * Fetch all workspace groups.
   * @returns List of groups
   */
  async getGroups(): Promise<{ groups: WorkspaceGroup[] }> {
    return this._fetch('/api/groups');
  }

  /**
   * Create a new workspace group.
   * @param data - Group name and optional color
   * @returns The created group
   */
  async createGroup(data: {
    name: string;
    color?: string;
  }): Promise<{ group: WorkspaceGroup }> {
    return this._fetch('/api/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing workspace group.
   * @param id - Group ID
   * @param data - Partial group fields to update
   * @returns The updated group
   */
  async updateGroup(
    id: string,
    data: Partial<WorkspaceGroup>
  ): Promise<{ group: WorkspaceGroup }> {
    return this._fetch(`/api/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a workspace group.
   * @param id - Group ID
   * @returns Success indicator
   */
  async deleteGroup(id: string): Promise<{ success: boolean }> {
    return this._fetch(`/api/groups/${id}`, { method: 'DELETE' });
  }

  /**
   * Add a workspace to a group.
   * @param groupId - Group ID
   * @param workspaceId - Workspace ID to add
   * @returns Success indicator
   */
  async addWorkspaceToGroup(
    groupId: string,
    workspaceId: string
  ): Promise<{ success: boolean }> {
    return this._fetch(`/api/groups/${groupId}/add`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    });
  }

  // ─── Templates ──────────────────────────────────────────

  /**
   * Fetch all session templates.
   * @returns List of templates
   */
  async getTemplates(): Promise<{ templates: SessionTemplate[] }> {
    return this._fetch('/api/templates');
  }

  /**
   * Create a new session template.
   * @param data - Template configuration
   * @returns The created template
   */
  async createTemplate(
    data: Partial<SessionTemplate>
  ): Promise<{ template: SessionTemplate }> {
    return this._fetch('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a session template.
   * @param id - Template ID
   * @returns Success indicator
   */
  async deleteTemplate(id: string): Promise<{ success: boolean }> {
    return this._fetch(`/api/templates/${id}`, { method: 'DELETE' });
  }

  // ─── Search ─────────────────────────────────────────────

  /**
   * Keyword search across session JSONL files.
   * @param query - Search query string
   * @param limit - Maximum number of results
   * @returns Matching search results
   */
  async search(
    query: string,
    limit?: number
  ): Promise<{ results: SearchResult[] }> {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set('limit', String(limit));
    return this._fetch(`/api/search?${params.toString()}`);
  }

  /**
   * AI-powered semantic search across session conversations.
   * @param data - Search query and optional workspace filter
   * @returns Matching search results
   */
  async searchConversations(data: {
    query: string;
    workspaceId?: string;
  }): Promise<{ results: SearchResult[] }> {
    return this._fetch('/api/search-conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ─── Conflicts ──────────────────────────────────────────

  /**
   * Get all detected file conflicts across sessions.
   * @returns List of file conflicts
   */
  async getConflicts(): Promise<{ conflicts: FileConflict[] }> {
    return this._fetch('/api/conflicts');
  }

  // ─── Resources ──────────────────────────────────────────

  /**
   * Fetch system and per-session resource metrics.
   * @returns System CPU/memory stats and Claude session resource usage
   */
  async getResources(): Promise<ResourceMetrics> {
    return this._fetch<ResourceMetrics>('/api/resources');
  }

  /**
   * Kill a process by PID on the server.
   * @param pid - OS process ID to terminate
   * @returns Success status and descriptive message
   */
  async killProcess(pid: number): Promise<{ success: boolean; message: string }> {
    return this._fetch('/api/resources/kill-process', {
      method: 'POST',
      body: JSON.stringify({ pid }),
    });
  }

  // ─── Discovery ──────────────────────────────────────────

  /**
   * Discover Claude sessions on the server's filesystem.
   * @returns List of discovered sessions
   */
  async discover(): Promise<{ sessions: any[] }> {
    return this._fetch('/api/discover');
  }

  /**
   * Browse directories on the server for working directory selection.
   * @param dirPath - Directory path to browse
   * @returns Lists of subdirectories and files
   */
  async browse(
    dirPath: string
  ): Promise<{ directories: string[]; files: string[] }> {
    return this._fetch(
      `/api/browse?path=${encodeURIComponent(dirPath)}`
    );
  }

  // ─── Workspace Docs ─────────────────────────────────────

  /**
   * Fetch all docs for a workspace (notes, goals, tasks, roadmap, rules).
   * @param workspaceId - Workspace ID
   * @returns All doc sections
   */
  async getWorkspaceDocs(
    workspaceId: string
  ): Promise<{ docs: WorkspaceDocs }> {
    return this._fetch(`/api/workspaces/${workspaceId}/docs`);
  }

  /**
   * Add an item to a specific doc section.
   * @param workspaceId - Workspace ID
   * @param section - Target section (notes, goals, tasks, roadmap, rules)
   * @param item - Item data (text, plus done/status for relevant sections)
   * @returns Updated docs
   */
  async addDocItem(
    workspaceId: string,
    section: DocSection,
    item: Record<string, unknown>
  ): Promise<{ docs: WorkspaceDocs }> {
    return this._fetch(`/api/workspaces/${workspaceId}/docs/${section}`, {
      method: 'POST',
      body: JSON.stringify(item),
    });
  }

  /**
   * Update an item at a specific index in a doc section.
   * @param workspaceId - Workspace ID
   * @param section - Target section
   * @param index - Item index within the section
   * @param item - Updated item data
   * @returns Updated docs
   */
  async updateDocItem(
    workspaceId: string,
    section: DocSection,
    index: number,
    item: Record<string, unknown>
  ): Promise<{ docs: WorkspaceDocs }> {
    return this._fetch(
      `/api/workspaces/${workspaceId}/docs/${section}/${index}`,
      {
        method: 'PUT',
        body: JSON.stringify(item),
      }
    );
  }

  /**
   * Delete an item at a specific index in a doc section.
   * @param workspaceId - Workspace ID
   * @param section - Target section
   * @param index - Item index to delete
   * @returns Updated docs
   */
  async deleteDocItem(
    workspaceId: string,
    section: DocSection,
    index: number
  ): Promise<{ docs: WorkspaceDocs }> {
    return this._fetch(
      `/api/workspaces/${workspaceId}/docs/${section}/${index}`,
      { method: 'DELETE' }
    );
  }

  // ─── Features ───────────────────────────────────────────

  /**
   * Fetch all features for a workspace.
   * @param workspaceId - Workspace ID
   * @returns Features list
   */
  async getFeatures(
    workspaceId: string
  ): Promise<{ features: Feature[] }> {
    return this._fetch(`/api/workspaces/${workspaceId}/features`);
  }

  /**
   * Create a new feature in a workspace.
   * @param workspaceId - Workspace ID
   * @param data - Feature creation fields
   * @returns The created feature
   */
  async createFeature(
    workspaceId: string,
    data: { name: string; description?: string; status?: string; priority?: string }
  ): Promise<{ feature: Feature }> {
    return this._fetch(`/api/workspaces/${workspaceId}/features`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing feature.
   * @param id - Feature ID
   * @param data - Partial feature fields to update
   * @returns The updated feature
   */
  async updateFeature(
    id: string,
    data: Partial<Feature>
  ): Promise<{ feature: Feature }> {
    return this._fetch(`/api/features/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a feature.
   * @param id - Feature ID
   * @returns Success indicator
   */
  async deleteFeature(id: string): Promise<{ success: boolean }> {
    return this._fetch(`/api/features/${id}`, { method: 'DELETE' });
  }

  // ─── Worktree Tasks ────────────────────────────────────────

  /**
   * Fetch all worktree tasks, optionally filtered by workspace.
   * @param workspaceId - Optional workspace filter
   * @returns List of worktree tasks
   */
  async getTasks(workspaceId?: string): Promise<{ tasks: WorktreeTask[] }> {
    const query = workspaceId
      ? `?workspaceId=${encodeURIComponent(workspaceId)}`
      : '';
    return this._fetch(`/api/worktree-tasks${query}`);
  }

  /**
   * Create a new worktree task.
   * @param data - Task creation parameters
   * @returns The newly created task
   */
  async createTask(data: CreateTaskInput): Promise<{ task: WorktreeTask }> {
    return this._fetch('/api/worktree-tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update an existing worktree task.
   * @param id - Task ID to update
   * @param data - Partial task fields to update
   * @returns The updated task
   */
  async updateTask(
    id: string,
    data: Partial<WorktreeTask>
  ): Promise<{ task: WorktreeTask }> {
    return this._fetch(`/api/worktree-tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a worktree task.
   * @param id - Task ID to delete
   * @returns Success indicator
   */
  async deleteTask(id: string): Promise<{ success: boolean }> {
    return this._fetch(`/api/worktree-tasks/${id}`, { method: 'DELETE' });
  }

  /**
   * Merge a worktree task branch into its base branch.
   * @param id - Task ID to merge
   * @returns Success status and descriptive message
   */
  async mergeTask(id: string): Promise<{ success: boolean; message: string }> {
    return this._fetch(`/api/worktree-tasks/${id}/merge`, { method: 'POST' });
  }

  /**
   * Reject a worktree task and clean up its branch.
   * @param id - Task ID to reject
   * @returns Success status and descriptive message
   */
  async rejectTask(id: string): Promise<{ success: boolean; message: string }> {
    return this._fetch(`/api/worktree-tasks/${id}/reject`, { method: 'POST' });
  }

  /**
   * Push a worktree task branch to the remote.
   * @param id - Task ID to push
   * @returns Success status and descriptive message
   */
  async pushTask(id: string): Promise<{ success: boolean; message: string }> {
    return this._fetch(`/api/worktree-tasks/${id}/push`, { method: 'POST' });
  }

  /**
   * Create a GitHub PR for a worktree task.
   * @param id - Task ID
   * @returns The created PR metadata
   */
  async createTaskPR(id: string): Promise<{ pr: TaskPR }> {
    return this._fetch(`/api/worktree-tasks/${id}/pr`, { method: 'POST' });
  }

  /**
   * Get the PR status for a worktree task.
   * @param id - Task ID
   * @returns PR metadata or null if no PR exists
   */
  async getTaskPR(id: string): Promise<{ pr: TaskPR | null }> {
    return this._fetch(`/api/worktree-tasks/${id}/pr`);
  }

  /**
   * Generate a PR title and body using AI for a worktree task.
   * @param id - Task ID
   * @returns Generated PR title and body text
   */
  async generatePRDescription(id: string): Promise<{ title: string; body: string }> {
    return this._fetch(`/api/worktree-tasks/${id}/pr/generate-description`, {
      method: 'POST',
    });
  }

  /**
   * Get the changed files and stats for a worktree task branch.
   * @param id - Task ID
   * @returns Changed file list and line statistics
   */
  async getTaskChanges(id: string): Promise<TaskChanges> {
    return this._fetch(`/api/worktree-tasks/${id}/changes`);
  }

  // ─── Push Notifications ─────────────────────────────────

  /**
   * Register a device push token with the server for notifications.
   * @param data - Push token and platform
   * @returns Success indicator
   */
  async registerPush(data: PushRegisterInput): Promise<{ success: boolean }> {
    return this._fetch('/api/push/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Unregister a device push token from the server.
   * @param deviceToken - The Expo push token to remove
   * @returns Success indicator
   */
  async unregisterPush(deviceToken: string): Promise<{ success: boolean }> {
    return this._fetch('/api/push/unregister', {
      method: 'POST',
      body: JSON.stringify({ deviceToken }),
    });
  }
}

/**
 * Factory function to create a new MyrlinAPIClient instance.
 * Preferred over direct constructor for consistency with other service factories.
 *
 * @param baseUrl - Server URL
 * @param token - Bearer auth token
 * @returns A configured MyrlinAPIClient
 */
export function createAPIClient(baseUrl: string, token: string): MyrlinAPIClient {
  return new MyrlinAPIClient(baseUrl, token);
}
