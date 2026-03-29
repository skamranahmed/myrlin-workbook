/**
 * offline.ts - Offline mutation queue with MMKV persistence.
 *
 * When the device is offline or the server is unreachable, mutation requests
 * (POST, PUT, DELETE, PATCH) are queued here instead of failing. On reconnect,
 * the queue replays each action via the API client's raw fetch.
 *
 * Queue is persisted to MMKV so it survives app restarts. Actions are dropped
 * after 3 failed replay attempts to prevent infinite retry loops.
 *
 * Pattern: Module-level singleton backed by MMKV storage instance.
 */

import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';

/** MMKV storage key for the persisted queue */
const QUEUE_KEY = 'offline_queue';

/** MMKV instance dedicated to offline queue persistence */
const storage: MMKV = createMMKV({ id: 'myrlin-offline' });

/** Maximum number of retry attempts before an action is dropped */
const MAX_RETRIES = 3;

/**
 * Represents a single queued mutation action.
 * Stored as JSON in MMKV and replayed when connectivity returns.
 */
export interface QueuedAction {
  /** Unique identifier for this queued action */
  id: string;
  /** HTTP method (POST, PUT, DELETE, PATCH) */
  method: string;
  /** Full URL of the API endpoint */
  url: string;
  /** Optional JSON body for the request */
  body?: unknown;
  /** Timestamp when the action was queued (epoch ms) */
  timestamp: number;
  /** Number of replay attempts that have failed */
  retries: number;
}

/**
 * Generate a simple unique ID for queued actions.
 * Uses timestamp + random suffix for uniqueness without external deps.
 * @returns A unique string identifier
 */
function generateQueueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Read the current queue from MMKV storage.
 * @returns Array of queued actions, empty array if none stored
 */
function readQueue(): QueuedAction[] {
  const raw = storage.getString(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedAction[];
  } catch {
    return [];
  }
}

/**
 * Write the queue to MMKV storage.
 * @param queue - Array of queued actions to persist
 */
function writeQueue(queue: QueuedAction[]): void {
  storage.set(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Add a mutation action to the offline queue.
 * The action is persisted immediately to MMKV so it survives app restarts.
 *
 * @param action - The mutation to queue (method, url, optional body)
 */
export function enqueueAction(
  action: Omit<QueuedAction, 'id' | 'timestamp' | 'retries'>
): void {
  const queue = readQueue();
  const entry: QueuedAction = {
    ...action,
    id: generateQueueId(),
    timestamp: Date.now(),
    retries: 0,
  };
  queue.push(entry);
  writeQueue(queue);
}

/**
 * Replay all queued actions against the server.
 * Iterates the queue in order; successful actions are removed,
 * failed actions have their retry count incremented. Actions that
 * exceed MAX_RETRIES are dropped to prevent infinite loops.
 *
 * @param baseUrl - Server base URL for making requests
 * @param token - Bearer auth token for the requests
 * @returns Counts of succeeded and failed replays
 */
export async function replayQueue(
  baseUrl: string,
  token: string
): Promise<{ succeeded: number; failed: number }> {
  const queue = readQueue();
  if (queue.length === 0) return { succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;
  const remaining: QueuedAction[] = [];

  for (const action of queue) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };

      const fetchOptions: RequestInit = {
        method: action.method,
        headers,
      };

      // Attach JSON body for mutation methods
      if (action.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(action.body);
      }

      const response = await fetch(action.url, fetchOptions);

      if (response.ok) {
        succeeded++;
      } else {
        // HTTP error (4xx/5xx); increment retries
        action.retries++;
        if (action.retries < MAX_RETRIES) {
          remaining.push(action);
        }
        failed++;
      }
    } catch {
      // Network error; increment retries
      action.retries++;
      if (action.retries < MAX_RETRIES) {
        remaining.push(action);
      }
      failed++;
    }
  }

  writeQueue(remaining);
  return { succeeded, failed };
}

/**
 * Get the number of actions currently in the offline queue.
 * @returns Queue length
 */
export function getQueueLength(): number {
  return readQueue().length;
}

/**
 * Remove all actions from the offline queue.
 * Used for manual queue clearing (e.g. from settings).
 */
export function clearQueue(): void {
  writeQueue([]);
}
