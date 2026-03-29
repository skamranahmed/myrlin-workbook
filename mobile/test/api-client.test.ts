/**
 * api-client.test.ts - Integration tests for MyrlinAPIClient.
 *
 * Validates that every API client method sends the correct HTTP request
 * (URL, method, headers, body) and returns properly typed responses.
 * Uses a mocked global fetch to intercept all requests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock the offline queue module so the API client import does not require MMKV
jest.mock('../utils/offline', () => ({
  enqueueAction: jest.fn(),
}));

import { MyrlinAPIClient, createAPIClient } from '../services/api-client';
import { enqueueAction } from '../utils/offline';

// ─── Test Helpers ─────────────────────────────────────────────

const BASE_URL = 'http://192.168.1.50:3456';
const TOKEN = 'test-bearer-token-abc123';

/** Creates a mock Response object with the given JSON body and status */
function mockResponse(body: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    clone: jest.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: jest.fn(),
    blob: jest.fn(),
    formData: jest.fn(),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
    bytes: jest.fn(),
  } as unknown as Response;
}

// ─── Setup ────────────────────────────────────────────────────

let client: MyrlinAPIClient;
let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
  client = createAPIClient(BASE_URL, TOKEN);
  (enqueueAction as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Auth Header Tests ────────────────────────────────────────

describe('Auth headers', () => {
  it('includes Authorization header on normal requests', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ sessions: [], recentSessions: [] }));
    await client.getSessions();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('omits Authorization header on pair request', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ token: 'new-token', serverName: 'Test' })
    );
    await client.pair('pairing-123', 'iPhone', 'ios');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('');
  });

  it('omits Authorization header on login request', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ token: 'new-token' })
    );
    await client.login('my-password');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('');
  });
});

// ─── Session Endpoints ────────────────────────────────────────

describe('Session endpoints', () => {
  it('getSessions returns session array on 200', async () => {
    const sessions = [{ id: 's1', topic: 'Test' }];
    mockFetch.mockResolvedValueOnce(mockResponse({ sessions }));

    const result = await client.getSessions();
    expect(result.sessions).toEqual(sessions);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sessions?mode=all'),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('getSessions with workspace mode sends correct params', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ sessions: [] }));
    await client.getSessions('workspace', { workspaceId: 'ws-1' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('mode=workspace');
    expect(url).toContain('workspaceId=ws-1');
  });

  it('getSessions throws on 401 unauthorized', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Unauthorized' }, 401));
    await expect(client.getSessions()).rejects.toThrow('401');
  });

  it('getSession returns single session on 200', async () => {
    const sessions = [
      { id: 's1', topic: 'First' },
      { id: 's2', topic: 'Second' },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse({ sessions }));

    const result = await client.getSession('s2');
    expect(result).toEqual({ id: 's2', topic: 'Second' });
  });

  it('createSession sends POST with correct body', async () => {
    const data = { cwd: '/home/user', workspaceId: 'ws-1' };
    mockFetch.mockResolvedValueOnce(
      mockResponse({ session: { id: 'new-1', ...data } })
    );

    await client.createSession(data as any);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/sessions`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(data);
  });

  it('deleteSession sends DELETE to correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ success: true }));
    await client.deleteSession('s1');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/sessions/s1`);
    expect(options.method).toBe('DELETE');
  });

  it('startSession sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ success: true, pid: 1234 }));
    const result = await client.startSession('s1');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/sessions/s1/start`);
    expect(options.method).toBe('POST');
    expect(result.pid).toBe(1234);
  });

  it('stopSession sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ success: true }));
    await client.stopSession('s1');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/sessions/s1/stop`);
    expect(options.method).toBe('POST');
  });

  it('restartSession sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ success: true, pid: 5678 }));
    const result = await client.restartSession('s1');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/sessions/s1/restart`);
    expect(options.method).toBe('POST');
    expect(result.pid).toBe(5678);
  });

  it('updateSession sends PUT with partial data', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ session: { id: 's1', topic: 'Renamed' } })
    );
    await client.updateSession('s1', { topic: 'Renamed' } as any);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/sessions/s1`);
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body).topic).toBe('Renamed');
  });
});

// ─── Workspace Endpoints ──────────────────────────────────────

describe('Workspace endpoints', () => {
  it('getWorkspaces returns workspace array', async () => {
    const workspaces = [{ id: 'ws-1', name: 'Backend' }];
    mockFetch.mockResolvedValueOnce(
      mockResponse({ workspaces, workspaceOrder: ['ws-1'] })
    );

    const result = await client.getWorkspaces();
    expect(result.workspaces).toEqual(workspaces);
  });

  it('createWorkspace sends POST with name', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ workspace: { id: 'ws-2', name: 'Frontend' } })
    );
    await client.createWorkspace({ name: 'Frontend' });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/workspaces`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).name).toBe('Frontend');
  });

  it('deleteWorkspace sends DELETE', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ success: true }));
    await client.deleteWorkspace('ws-1');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/workspaces/ws-1`);
    expect(options.method).toBe('DELETE');
  });
});

// ─── Cost Endpoints ───────────────────────────────────────────

describe('Cost endpoints', () => {
  it('getCostDashboard sends correct period param', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ summary: {}, timeline: [], breakdowns: {} })
    );
    await client.getCostDashboard('week');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/cost/dashboard?period=week');
  });

  it('getSessionCost fetches cost for specific session', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ totalCost: 1.25, inputTokens: 1000 })
    );
    await client.getSessionCost('s1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/sessions/s1/cost`);
  });
});

// ─── Task Endpoints ───────────────────────────────────────────

describe('Task endpoints', () => {
  it('getTasks returns task array', async () => {
    const tasks = [{ id: 't1', description: 'Fix bug' }];
    mockFetch.mockResolvedValueOnce(mockResponse({ tasks }));

    const result = await client.getTasks();
    expect(result.tasks).toEqual(tasks);
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/worktree-tasks`);
  });

  it('getTasks with workspaceId filter', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ tasks: [] }));
    await client.getTasks('ws-1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('workspaceId=ws-1');
  });

  it('createTask sends POST with data', async () => {
    const data = { description: 'Add auth', workspaceId: 'ws-1' };
    mockFetch.mockResolvedValueOnce(
      mockResponse({ task: { id: 't2', ...data } })
    );
    await client.createTask(data as any);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/worktree-tasks`);
    expect(options.method).toBe('POST');
  });

  it('deleteTask sends DELETE', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ success: true }));
    await client.deleteTask('t1');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/worktree-tasks/t1`);
    expect(options.method).toBe('DELETE');
  });
});

// ─── Push Endpoints ───────────────────────────────────────────

describe('Push endpoints', () => {
  it('registerPush sends POST with deviceToken and platform', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ success: true }));
    await client.registerPush({
      deviceToken: 'ExponentPushToken[abc]',
      platform: 'ios',
    } as any);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/push/register`);
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.deviceToken).toBe('ExponentPushToken[abc]');
    expect(body.platform).toBe('ios');
  });

  it('unregisterPush sends POST with token', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ success: true }));
    await client.unregisterPush('ExponentPushToken[abc]');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/push/unregister`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).deviceToken).toBe('ExponentPushToken[abc]');
  });
});

// ─── Error Handling ───────────────────────────────────────────

describe('Error handling', () => {
  it('throws on 500 server error', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'Internal Server Error' }, 500)
    );
    await expect(client.getSessions()).rejects.toThrow('500');
  });

  it('throws on 404 not found', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: 'Not Found' }, 404)
    );
    await expect(client.getSession('nonexistent')).rejects.toThrow('404');
  });

  it('queues mutation on network error instead of throwing', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    const result = await client.deleteSession('s1');
    expect((enqueueAction as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        url: `${BASE_URL}/api/sessions/s1`,
      })
    );
    expect((result as any).queued).toBe(true);
  });

  it('rethrows network error on GET requests', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(client.getSessions()).rejects.toThrow('Network request failed');
  });
});

// ─── Factory Function ─────────────────────────────────────────

describe('createAPIClient', () => {
  it('creates a MyrlinAPIClient instance', () => {
    const c = createAPIClient('http://localhost:3456', 'tok');
    expect(c).toBeInstanceOf(MyrlinAPIClient);
  });

  it('strips trailing slash from base URL', async () => {
    const c = createAPIClient('http://localhost:3456/', 'tok');
    mockFetch.mockResolvedValueOnce(mockResponse({ sessions: [] }));
    await c.getSessions();

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain('//api');
  });
});
