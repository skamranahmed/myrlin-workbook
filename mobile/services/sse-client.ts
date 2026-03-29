/**
 * sse-client.ts - Server-Sent Events client for real-time server updates.
 *
 * Uses react-native-sse (RNEventSource) to subscribe to the Myrlin server's
 * /api/events endpoint. Parses JSON event payloads and dispatches them to
 * a handler callback. Does NOT manage React state directly; the useSSE hook
 * bridges SSE events to TanStack Query cache invalidation.
 *
 * Auth is passed as a query parameter (EventSource cannot set custom headers).
 */

import RNEventSource from 'react-native-sse';

/** Shape of a parsed SSE event passed to the handler */
type SSEEventPayload = { type: string; data: any };

/** Callback function that receives parsed SSE events */
type SSEEventHandler = (event: SSEEventPayload) => void;

/**
 * SSEClient - Manages a single SSE connection to a Myrlin server.
 *
 * Handles connection lifecycle, JSON parsing, and error recovery.
 * RNEventSource handles automatic reconnection internally.
 *
 * @example
 * ```ts
 * const client = new SSEClient((event) => {
 *   console.log(event.type, event.data);
 * });
 * client.connect('http://192.168.1.50:3456', myToken);
 * // Later:
 * client.disconnect();
 * ```
 */
export class SSEClient {
  /** Active EventSource instance, null when disconnected */
  private es: RNEventSource | null = null;

  /** Handler callback for parsed events */
  private handler: SSEEventHandler;

  /**
   * Create an SSE client with the given event handler.
   * @param handler - Callback invoked for each parsed SSE event
   */
  constructor(handler: SSEEventHandler) {
    this.handler = handler;
  }

  /**
   * Open an SSE connection to the server's event stream.
   * Closes any existing connection first.
   * Auth token is passed as a query parameter since EventSource
   * does not support custom headers.
   *
   * @param baseUrl - Server base URL (e.g. "http://192.168.1.50:3456")
   * @param token - Bearer auth token
   */
  connect(baseUrl: string, token: string): void {
    this.disconnect();
    const url = `${baseUrl}/api/events?token=${encodeURIComponent(token)}`;
    this.es = new RNEventSource(url);

    this.es.addEventListener('message', (event: any) => {
      try {
        const parsed = JSON.parse(event.data);
        this.handler(parsed);
      } catch {
        // Silently ignore malformed JSON payloads
      }
    });

    this.es.addEventListener('error', () => {
      // RNEventSource handles reconnection internally.
      // Error events are expected during network interruptions.
    });
  }

  /**
   * Close the current SSE connection and clean up.
   * Safe to call when already disconnected.
   */
  disconnect(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }
}
