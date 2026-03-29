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
