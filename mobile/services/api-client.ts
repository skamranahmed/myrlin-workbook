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
