/**
 * api.ts - Shared TypeScript types for server API responses and connections.
 *
 * Defines the contract between the Myrlin mobile app and Myrlin server.
 * All API response shapes, server connection metadata, and error types
 * used across the services and stores layers.
 */

// ─── Server Connection ─────────────────────────────────────

/**
 * Represents a paired server that the mobile app can connect to.
 * Stored encrypted in SecureStore via the server store.
 */
export interface ServerConnection {
  /** Unique identifier (UUID v4) */
  id: string;
  /** User-given display name (e.g. "Home PC", "Work") */
  name: string;
  /** Full server URL including protocol and port */
  url: string;
  /** Bearer auth token for API requests */
  token: string;
  /** ISO timestamp of when this server was paired */
  pairedAt: string;
  /** ISO timestamp of last successful connection */
  lastConnected: string;
  /** How the server is accessed from this device */
  tunnelType: 'lan' | 'cloudflare' | 'tailscale' | 'relay';
}

/**
 * Connection state for the currently active server.
 */
export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'token-expired';

// ─── API Responses ─────────────────────────────────────────

/**
 * Response from GET /api/auth/pairing-code.
 * Contains the pairing token and QR payload for mobile scanning.
 */
export interface PairingCodeResponse {
  /** Short-lived pairing token (64 hex chars) */
  pairingToken: string;
  /** ISO timestamp when the pairing token expires */
  expiresAt: string;
  /** JSON-encoded QR payload string with url, pairingToken, serverName, version */
  qrPayload: string;
}

/**
 * Response from POST /api/auth/pair.
 * Returned after successfully exchanging a pairing token for a Bearer token.
 */
export interface PairResponse {
  /** Whether the pairing was successful */
  success: boolean;
  /** Long-lived Bearer token for subsequent API calls */
  token: string;
  /** Name of the paired server (from package.json) */
  serverName: string;
  /** Version of the paired server (from package.json) */
  serverVersion: string;
}

/**
 * Response from POST /api/auth/login.
 * Success returns a token; failure returns an error message.
 */
export type LoginResponse =
  | { success: true; token: string }
  | { success: false; error: string };

/**
 * Response from GET /api/auth/check.
 * Indicates whether the provided Bearer token is still valid.
 */
export interface AuthCheckResponse {
  /** True if the token is valid */
  authenticated: boolean;
}

// ─── Sessions ─────────────────────────────────────────────

/**
 * Represents a Claude Code session managed by the Myrlin server.
 * Contains process state, metadata, and activity logs.
 */
export interface Session {
  /** Unique identifier (UUID) */
  id: string;
  /** User-visible session name */
  name: string;
  /** ID of the workspace this session belongs to */
  workspaceId: string;
  /** Filesystem path the session operates in */
  workingDir: string;
  /** Session topic or description */
  topic: string;
  /** CLI command used to launch the session */
  command: string;
  /** If resuming a prior Claude session, its ID */
  resumeSessionId: string | null;
  /** Current process status */
  status: 'stopped' | 'running' | 'error' | 'idle';
  /** OS process ID when running, null when stopped */
  pid: number | null;
  /** User-applied tags for organization */
  tags: string[];
  /** Initial prompt text sent at session start */
  initialPrompt: string | null;
  /** CLI flags passed to the session */
  flags: string[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last activity */
  lastActive: string;
  /** Recent log entries for activity display */
  logs: SessionLog[];
}

/**
 * Single timestamped log entry from a session.
 */
export interface SessionLog {
  /** ISO timestamp of the log entry */
  time: string;
  /** Log message text */
  message: string;
}

/**
 * Cost breakdown for a session, computed from JSONL usage data.
 */
export interface SessionCost {
  /** Total cost in USD */
  totalCost: number;
  /** Per-category token and cost breakdown */
  breakdown: {
    input: { tokens: number; cost: number };
    output: { tokens: number; cost: number };
    cacheWrite: { tokens: number; cost: number };
    cacheRead: { tokens: number; cost: number };
  };
  /** Costs grouped by model name */
  byModel: Record<string, { input: number; output: number; cost: number }>;
  /** Total number of messages in the session */
  messageCount: number;
}

// ─── Workspaces ───────────────────────────────────────────

/**
 * Workspace container that groups related sessions together.
 */
export interface Workspace {
  /** Unique identifier */
  id: string;
  /** Workspace display name */
  name: string;
  /** Optional description of the workspace purpose */
  description: string;
  /** Hex color code for visual identification */
  color: string;
  /** IDs of sessions belonging to this workspace */
  sessions: string[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last activity across all sessions */
  lastActive: string;
  /** Whether auto-summary is enabled for this workspace */
  autoSummary: boolean;
}

/**
 * Group of workspaces for hierarchical organization.
 */
export interface WorkspaceGroup {
  /** Unique identifier */
  id: string;
  /** Group display name */
  name: string;
  /** Hex color code for visual identification */
  color: string;
  /** Ordered list of workspace IDs in this group */
  workspaceIds: string[];
  /** Sort order position */
  order: number;
}

// ─── Templates ────────────────────────────────────────────

/**
 * Saved session configuration for quick re-creation.
 */
export interface SessionTemplate {
  /** Unique identifier */
  id: string;
  /** Template display name */
  name: string;
  /** CLI command for the session */
  command: string;
  /** Default working directory */
  workingDir: string;
  /** Whether to bypass permission prompts */
  bypassPermissions: boolean;
  /** Whether to enable verbose output */
  verbose: boolean;
  /** Model identifier (e.g. "claude-opus-4-6") */
  model: string;
  /** Whether agent teams mode is enabled */
  agentTeams: boolean;
  /** ISO timestamp of creation */
  createdAt: string;
}

// ─── Conflicts ────────────────────────────────────────────

/**
 * Detected file conflict where multiple sessions edit the same file.
 */
export interface FileConflict {
  /** Path of the conflicting file */
  file: string;
  /** Sessions that are editing this file */
  sessions: { id: string; name: string }[];
  /** ISO timestamp when the conflict was detected */
  detectedAt: string;
}

// ─── SSE Events ───────────────────────────────────────────

/**
 * Server-Sent Event payload from the /api/events endpoint.
 * The type field identifies the event kind, data carries the payload.
 */
export type SSEEvent = {
  /** Event type (e.g. "session:created", "workspace:updated") */
  type: string;
  /** Event payload, shape varies by event type */
  data: any;
};

// ─── Session Creation ─────────────────────────────────────

/**
 * Input data for creating a new session via POST /api/sessions.
 */
export interface CreateSessionInput {
  /** Session display name */
  name: string;
  /** Target workspace ID */
  workspaceId: string;
  /** Filesystem path for the session */
  workingDir: string;
  /** Optional CLI command override */
  command?: string;
  /** Optional model identifier */
  model?: string;
  /** Optional template ID to base the session on */
  templateId?: string;
  /** Optional initial prompt text */
  initialPrompt?: string;
  /** Optional CLI flags */
  flags?: string[];
}

// ─── Search ───────────────────────────────────────────────

/**
 * Single search result from keyword or semantic search.
 */
export interface SearchResult {
  /** ID of the session containing the match */
  sessionId: string;
  /** Name of the matching session */
  sessionName: string;
  /** Matching message text */
  message: string;
  /** Role of the message author */
  role: string;
  /** ISO timestamp of the message */
  timestamp: string;
  /** Highlighted text fragments (if available) */
  highlights?: string[];
}

// ─── Subagents ────────────────────────────────────────────

/**
 * A subagent spawned by a parent session for delegated work.
 */
export interface Subagent {
  /** Unique identifier */
  id: string;
  /** Parent session ID (null for top-level agents) */
  parentId: string | null;
  /** Subagent display name */
  name: string;
  /** Current status of the subagent */
  status: string;
}

// ─── Errors ────────────────────────────────────────────────

/**
 * Error thrown when an API request returns a non-OK HTTP status.
 * Carries the HTTP status code and response body for error handling.
 */
export class APIError extends Error {
  /** HTTP status code from the response */
  status: number;
  /** Raw response body text */
  body: string;

  /**
   * Create an APIError from a failed HTTP response.
   * @param message - Human-readable error description
   * @param status - HTTP status code
   * @param body - Raw response body
   */
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.body = body;
  }
}
