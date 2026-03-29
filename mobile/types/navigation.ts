/**
 * navigation.ts - Typed route parameters for expo-router navigation.
 *
 * Defines parameter types for all screens to ensure compile-time
 * safety when navigating between routes. Tab routes have no params;
 * detail screens accept entity IDs.
 */

/** Tab route names (no parameters) */
export type TabRoute =
  | '(tabs)/sessions'
  | '(tabs)/tasks'
  | '(tabs)/costs'
  | '(tabs)/docs'
  | '(tabs)/more';

/** Parameter types for detail screens (future, Phase 3+) */
export type SessionDetailParams = {
  /** Session UUID from the server */
  sessionId: string;
};

export type TaskDetailParams = {
  /** Task identifier */
  taskId: string;
};

export type DocDetailParams = {
  /** Workspace ID that owns the document */
  workspaceId: string;
  /** Document slug (notes, goals, tasks, rules) */
  docSlug: string;
};

export type WorkspaceDetailParams = {
  /** Workspace UUID */
  workspaceId: string;
};

/** Parameters for the terminal route */
export type TerminalParams = {
  /** Session UUID to open in the terminal */
  id: string;
};

/**
 * Combined route parameter map for the entire app.
 * Used with expo-router's typed routes for compile-time navigation safety.
 */
export type AppRouteParams = {
  '(tabs)': undefined;
  '(tabs)/sessions/index': undefined;
  '(tabs)/sessions/terminal': TerminalParams;
  '(tabs)/tasks/index': undefined;
  '(tabs)/costs/index': undefined;
  '(tabs)/docs/index': undefined;
  '(tabs)/more/index': undefined;
  'session/[sessionId]': SessionDetailParams;
  'task/[taskId]': TaskDetailParams;
  'doc/[workspaceId]/[docSlug]': DocDetailParams;
  'workspace/[workspaceId]': WorkspaceDetailParams;
};
