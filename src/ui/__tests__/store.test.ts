import { describe, expect, it } from 'vitest';
import {
  clearRequests,
  createInitialState,
  filterRequests,
  JS_MATCH_WINDOW_MS,
  onJsRequestSent,
  onNativeRequestCompleted,
  onNativeRequestFailed,
  onNativeRequestStarted,
  onNativeResponseReceived,
  settleOrigins,
} from '../store';
import type { JsRequestSentEvent, NativeRequestStartedEvent } from '../../shared/events';

const started = (overrides: Partial<NativeRequestStartedEvent> = {}): NativeRequestStartedEvent => ({
  requestId: 'req-1',
  url: 'https://api.example.com/users/1',
  method: 'GET',
  headers: { accept: 'application/json' },
  body: null,
  timestamp: 1_000,
  platform: 'android',
  transport: 'okhttp',
  client: 'react-native-client',
  ...overrides,
});

const jsSent = (overrides: Partial<JsRequestSentEvent> = {}): JsRequestSentEvent => ({
  jsId: 'js-1',
  url: 'https://api.example.com/users/1',
  method: 'GET',
  timestamp: 990,
  api: 'fetch',
  ...overrides,
});

describe('store', () => {
  it('labels a native request as JS when a matching announcement arrived first', () => {
    let state = createInitialState();
    state = onJsRequestSent(state, jsSent());
    state = onNativeRequestStarted(state, started());

    expect(state.requests).toHaveLength(1);
    expect(state.requests[0].origin).toBe('js');
    expect(state.requests[0].jsApi).toBe('fetch');
    expect(state.unmatchedJs).toHaveLength(0);
  });

  it('labels a native request as JS when the announcement arrives after the native start', () => {
    let state = createInitialState();
    state = onNativeRequestStarted(state, started());
    state = onJsRequestSent(state, jsSent({ timestamp: 1_010, api: 'xhr' }));

    expect(state.requests[0].origin).toBe('js');
    expect(state.requests[0].jsApi).toBe('xhr');
  });

  it('does not pair a JS announcement with a different URL or method', () => {
    let state = createInitialState();
    state = onJsRequestSent(state, jsSent({ url: 'https://api.example.com/users/2' }));
    state = onJsRequestSent(state, jsSent({ jsId: 'js-2', method: 'POST' }));
    state = onNativeRequestStarted(state, started());

    expect(state.requests[0].origin).toBe('unknown');
    expect(state.unmatchedJs).toHaveLength(2);
  });

  it('ignores trailing slashes and fragments when pairing', () => {
    let state = createInitialState();
    state = onJsRequestSent(state, jsSent({ url: 'https://api.example.com/users/1/#top' }));
    state = onNativeRequestStarted(state, started());

    expect(state.requests[0].origin).toBe('js');
  });

  it('pairs each announcement with only one native request', () => {
    let state = createInitialState();
    state = onJsRequestSent(state, jsSent());
    state = onNativeRequestStarted(state, started({ requestId: 'a' }));
    state = onNativeRequestStarted(state, started({ requestId: 'b', timestamp: 1_050 }));

    expect(state.requests.map((request) => request.origin)).toEqual(['js', 'unknown']);
  });

  it('settles unknown rows to native once the pairing window closes', () => {
    let state = createInitialState();
    state = onNativeRequestStarted(state, started());

    expect(settleOrigins(state, 1_000 + JS_MATCH_WINDOW_MS).requests[0].origin).toBe('unknown');
    expect(settleOrigins(state, 1_001 + JS_MATCH_WINDOW_MS).requests[0].origin).toBe('native');
  });

  it('drops stale JS announcements', () => {
    let state = createInitialState();
    state = onJsRequestSent(state, jsSent({ timestamp: 0 }));
    state = onNativeRequestStarted(state, started({ timestamp: 60_000 }));

    expect(state.unmatchedJs).toHaveLength(0);
    expect(state.requests[0].origin).toBe('unknown');
  });

  it('applies response, completion and failure to the right request', () => {
    let state = createInitialState();
    state = onNativeRequestStarted(state, started({ requestId: 'a' }));
    state = onNativeRequestStarted(state, started({ requestId: 'b' }));
    state = onNativeResponseReceived(state, {
      requestId: 'a',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      mimeType: 'application/json',
      timestamp: 1_100,
    });
    state = onNativeRequestCompleted(state, {
      requestId: 'a',
      timestamp: 1_200,
      size: 42,
      body: { kind: 'text', value: '{}', truncated: false, size: 2 },
    });
    state = onNativeRequestFailed(state, {
      requestId: 'b',
      timestamp: 1_300,
      error: 'Connection reset',
      canceled: false,
    });

    const [a, b] = state.requests;
    expect(a.status).toBe('completed');
    expect(a.httpStatus).toBe(200);
    expect(a.size).toBe(42);
    expect(a.responseBody).toEqual({ kind: 'text', value: '{}', truncated: false, size: 2 });
    expect(b.status).toBe('failed');
    expect(b.error).toBe('Connection reset');
  });

  it('ignores events for unknown request ids', () => {
    const state = createInitialState();
    const next = onNativeRequestCompleted(state, {
      requestId: 'nope',
      timestamp: 1,
      size: 0,
      body: null,
    });
    expect(next).toBe(state);
  });

  it('ignores a duplicated start event', () => {
    let state = createInitialState();
    state = onNativeRequestStarted(state, started());
    const next = onNativeRequestStarted(state, started());
    expect(next).toBe(state);
  });

  it('clears requests but keeps pending JS announcements', () => {
    let state = createInitialState();
    state = onJsRequestSent(state, jsSent());
    state = onNativeRequestStarted(state, started({ url: 'https://other.example.com/' }));
    state = clearRequests(state);

    expect(state.requests).toHaveLength(0);
    expect(state.unmatchedJs).toHaveLength(1);
  });

  it('filters by origin, failure and free text', () => {
    let state = createInitialState();
    state = onJsRequestSent(state, jsSent());
    state = onNativeRequestStarted(state, started({ requestId: 'js' }));
    state = onNativeRequestStarted(
      state,
      started({ requestId: 'img', url: 'https://cdn.example.com/logo.png' }),
    );
    state = onNativeResponseReceived(state, {
      requestId: 'img',
      status: 404,
      statusText: 'Not Found',
      headers: {},
      mimeType: 'text/html',
      timestamp: 1_100,
    });

    expect(filterRequests(state.requests, '', 'all')).toHaveLength(2);
    expect(filterRequests(state.requests, '', 'js').map((request) => request.id)).toEqual(['js']);
    expect(filterRequests(state.requests, '', 'native').map((request) => request.id)).toEqual(['img']);
    expect(filterRequests(state.requests, '', 'failed').map((request) => request.id)).toEqual(['img']);
    expect(filterRequests(state.requests, 'logo', 'all').map((request) => request.id)).toEqual(['img']);
    expect(filterRequests(state.requests, '404', 'all').map((request) => request.id)).toEqual(['img']);
  });
});
