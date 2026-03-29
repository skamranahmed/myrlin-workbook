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

// ─── Resources ───────────────────────────────────────────

/**
 * System-level hardware metrics (CPU, memory, uptime).
 * Returned as part of the ResourceMetrics response.
 */
export interface SystemInfo {
  /** Number of logical CPU cores */
  cpuCount: number;
  /** Current CPU usage percentage (0-100) */
  cpuUsage: number;
  /** Total system memory in megabytes */
  totalMemoryMB: number;
  /** Free (available) memory in megabytes */
  freeMemoryMB: number;
  /** Used memory in megabytes */
  usedMemoryMB: number;
  /** System uptime in seconds */
  uptimeSeconds: number;
}

/**
 * Per-session resource consumption metrics for a running Claude session.
 * Includes process ID, CPU, memory, and any bound network ports.
 */
export interface ClaudeSessionResource {
  /** Session unique identifier */
  sessionId: string;
  /** Human-readable session name */
  sessionName: string;
  /** Workspace this session belongs to, if any */
  workspaceName: string | null;
  /** Filesystem working directory, if set */
  workingDir: string | null;
  /** OS process ID */
  pid: number;
  /** Memory consumption in megabytes */
  memoryMB: number;
  /** CPU usage percentage for this process */
  cpuPercent: number;
  /** Network ports bound by this session */
  ports: number[];
  /** Current process status string */
  status: string;
}

/**
 * Aggregated resource metrics from GET /api/resources.
 * Contains system-level stats and per-Claude-session breakdown.
 */
export interface ResourceMetrics {
  /** System hardware metrics */
  system: SystemInfo;
  /** Per-session resource consumption */
  claudeSessions: ClaudeSessionResource[];
  /** Sum of memory across all Claude sessions */
  totalClaudeMemoryMB: number;
  /** Sum of CPU across all Claude sessions */
  totalClaudeCpuPercent: number;
}

// ─── Workspace Docs ──────────────────────────────────────────

/** A note item in the workspace docs notes section */
export interface DocNoteItem {
  /** Note text content */
  text: string;
}

/** A goal item with completion tracking */
export interface DocGoalItem {
  /** Goal text content */
  text: string;
  /** Whether the goal is completed */
  done: boolean;
}

/** A task item with completion tracking */
export interface DocTaskItem {
  /** Task text content */
  text: string;
  /** Whether the task is completed */
  done: boolean;
}

/** A roadmap item with status tracking */
export interface DocRoadmapItem {
  /** Roadmap item text content */
  text: string;
  /** Current status of the roadmap item */
  status: 'planned' | 'active' | 'done';
}

/** A rule item in the workspace docs rules section */
export interface DocRuleItem {
  /** Rule text content */
  text: string;
}

/** Valid doc section names */
export type DocSection = 'notes' | 'goals' | 'tasks' | 'roadmap' | 'rules';

/** Complete workspace documentation with all 5 sections */
export interface WorkspaceDocs {
  /** Free-form notes */
  notes: DocNoteItem[];
  /** Trackable goals with completion state */
  goals: DocGoalItem[];
  /** Trackable tasks with completion state */
  tasks: DocTaskItem[];
  /** Roadmap items with planned/active/done status */
  roadmap: DocRoadmapItem[];
  /** Workspace rules and conventions */
  rules: DocRuleItem[];
}

// ─── Features ────────────────────────────────────────────────

/** A feature on the workspace kanban board */
export interface Feature {
  /** Unique identifier */
  id: string;
  /** Parent workspace ID */
  workspaceId: string;
  /** Feature name */
  name: string;
  /** Optional description of the feature */
  description?: string;
  /** Current board column */
  status: 'backlog' | 'active' | 'done';
  /** Optional priority level */
  priority?: 'low' | 'medium' | 'high';
  /** IDs of sessions linked to this feature */
  sessionIds: string[];
  /** ISO timestamp of creation */
  createdAt: string;
}

// ─── Worktree Tasks ──────────────────────────────────────────

/**
 * Status of a worktree task in the kanban pipeline.
 */
export type TaskStatus = 'backlog' | 'planning' | 'running' | 'review' | 'done';

/**
 * A worktree-based development task managed by the server.
 * Tracks branch, session, status, and enriched git metadata.
 */
export interface WorktreeTask {
  /** Unique identifier */
  id: string;
  /** Owning workspace ID */
  workspaceId: string;
  /** Associated Claude session ID (null if not started) */
  sessionId: string | null;
  /** Git branch name for the worktree */
  branch: string;
  /** Filesystem path to the worktree (null if not created) */
  worktreePath: string | null;
  /** Root repo directory */
  repoDir: string;
  /** Human-readable task description */
  description: string;
  /** Branch to merge into */
  baseBranch: string;
  /** Optional feature grouping ID */
  featureId: string | null;
  /** AI model assigned to this task */
  model: string | null;
  /** User-applied tags */
  tags: string[];
  /** Current kanban status */
  status: TaskStatus;
  /** List of blocker descriptions */
  blockers: string[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** Number of commits ahead of base branch */
  branchAhead: number;
  /** Number of files changed in the worktree */
  changedFiles: number;
}

/**
 * Input data for creating a new worktree task via POST /api/worktree-tasks.
 */
export interface CreateTaskInput {
  /** Target workspace ID */
  workspaceId: string;
  /** Root repo directory on the server */
  repoDir: string;
  /** Git branch name */
  branch: string;
  /** Task description */
  description: string;
  /** Base branch to diverge from (default "main") */
  baseBranch?: string;
  /** Optional feature grouping ID */
  featureId?: string;
  /** AI model to assign */
  model?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Whether to start immediately vs backlog */
  startNow?: boolean;
  /** Initial prompt for the session */
  prompt?: string;
  /** CLI flags to pass to the session */
  flags?: string[];
}

/**
 * Pull request metadata associated with a worktree task.
 */
export interface TaskPR {
  /** GitHub PR URL */
  url: string;
  /** PR number */
  number: number;
  /** PR title */
  title: string;
  /** PR state (open, closed, merged) */
  state?: string;
  /** Whether the PR has been merged */
  merged?: boolean;
}

/**
 * Changed files and stats for a worktree task branch.
 */
export interface TaskChanges {
  /** List of changed file paths */
  files: string[];
  /** Aggregate line change statistics */
  stats: { additions: number; deletions: number; total: number };
}

// ─── Cost Dashboard ──────────────────────────────────────────

/**
 * Time period filter for cost dashboard queries.
 * Maps to the period query param on GET /api/cost/dashboard.
 */
export type CostPeriod = 'day' | 'week' | 'month' | 'all';

/**
 * Full response shape from GET /api/cost/dashboard?period={period}.
 * Contains summary metrics, timeline data, and breakdowns by model,
 * workspace, and individual sessions.
 */
export interface CostDashboardResponse {
  /** Aggregate cost metrics for the selected period */
  summary: {
    /** Total cost in USD across all time */
    totalCost: number;
    /** Total tokens by category */
    totalTokens: {
      input: number;
      output: number;
      cacheWrite: number;
      cacheRead: number;
    };
    /** Cost within the selected time period */
    periodCost: number;
    /** Human-readable period label (e.g. "Last 7 days") */
    periodLabel: string;
    /** Total message count in the period */
    messageCount: number;
    /** Average cost per message in USD */
    avgCostPerMessage: number;
    /** Estimated savings from cache reads in USD */
    cacheSavings: number;
  };
  /** Daily cost timeline for charting */
  timeline: Array<{
    /** Date string in YYYY-MM-DD format */
    date: string;
    /** Cost for this day in USD */
    cost: number;
    /** Total tokens used this day */
    tokens: number;
    /** Number of messages this day */
    messages: number;
  }>;
  /** Cost breakdown by model */
  byModel: Array<{
    /** Model identifier string */
    model: string;
    /** Total cost for this model in USD */
    cost: number;
    /** Total tokens used by this model */
    tokens: number;
    /** Percentage of total cost (0-100) */
    pct: number;
  }>;
  /** Cost breakdown by workspace */
  byWorkspace: Array<{
    /** Workspace ID */
    id: string;
    /** Workspace display name */
    name: string;
    /** Total cost for this workspace in USD */
    cost: number;
    /** Number of sessions in this workspace */
    sessionCount: number;
    /** Percentage of total cost (0-100) */
    pct: number;
  }>;
  /** Top sessions ranked by cost */
  sessions: Array<{
    /** Session ID */
    id: string;
    /** Session display name */
    name: string;
    /** Workspace ID the session belongs to */
    workspaceId: string;
    /** Workspace display name */
    workspaceName: string;
    /** Total cost in USD */
    cost: number;
    /** Number of messages */
    messageCount: number;
    /** Model used by this session */
    model: string;
    /** ISO timestamp of last activity (null if never active) */
    lastActive: string | null;
    /** ISO timestamp of first message (null if no messages) */
    firstMessage: string | null;
  }>;
}

// ─── Push Notifications ───────────────────────────────────

/** Input for registering a device push token with the server */
export interface PushRegisterInput {
  /** Expo push token string */
  deviceToken: string;
  /** Device platform */
  platform: 'ios' | 'android';
}

/** Push notification data payload sent from the server */
export interface PushNotificationData {
  /** Type of event that triggered the notification */
  type: 'session' | 'task' | 'conflict';
  /** Session ID (present for session events) */
  sessionId?: string;
  /** Task ID (present for task events) */
  taskId?: string;
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
