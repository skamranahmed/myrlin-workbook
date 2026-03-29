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
