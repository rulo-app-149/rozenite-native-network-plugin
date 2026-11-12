import type {
  Headers,
  JsRequestSentEvent,
  NativeClientKind,
  NativeRequestCompletedEvent,
  NativeRequestFailedEvent,
  NativeRequestStartedEvent,
  NativeResponseReceivedEvent,
  Platform,
  RequestBody,
  ResponseBody,
  Transport,
} from '../shared/events';

export type Origin = 'js' | 'native' | 'unknown';

export type RequestStatus = 'pending' | 'completed' | 'failed';

export type NetworkRequest = {
  id: string;
  url: string;
  method: string;
  requestHeaders: Headers;
  requestBody: RequestBody;
  startedAt: number;
  platform: Platform;
  transport: Transport;
  client: NativeClientKind;

  origin: Origin;
  /** `fetch` / `xhr` when the request was matched to a JS announcement. */
  jsApi?: 'fetch' | 'xhr';

  status: RequestStatus;
  httpStatus?: number;
  statusText?: string;
  responseHeaders?: Headers;
  mimeType?: string;
  finalUrl?: string;
  protocol?: string;
  fromCache?: boolean;
  responseAt?: number;
  completedAt?: number;
  size?: number;
  responseBody?: ResponseBody;
  error?: string;
  canceled?: boolean;
};

export type StoreState = {
  requests: NetworkRequest[];
  byId: Record<string, number>;
  /** JS announcements not yet matched to a native request, oldest first. */
  unmatchedJs: JsRequestSentEvent[];
};

export const createInitialState = (): StoreState => ({
  requests: [],
  byId: {},
  unmatchedJs: [],
});

/** How far apart (ms) a JS announcement and a native start may be to pair up. */
export const JS_MATCH_WINDOW_MS = 5000;

/** Oldest JS announcement worth keeping around while waiting for native events. */
const JS_RETENTION_MS = 30000;

export const MAX_REQUESTS = 2000;

const normaliseUrl = (url: string): string => {
  // Trailing-slash and fragment differences between what JS asked for and
  // what the native stack reports should not break pairing.
  const withoutFragment = url.split('#')[0] ?? url;
  return withoutFragment.replace(/\/+$/, '');
};

const matchesJs = (js: JsRequestSentEvent, native: NativeRequestStartedEvent): boolean =>
  js.method === native.method.toUpperCase() &&
  normaliseUrl(js.url) === normaliseUrl(native.url) &&
  Math.abs(js.timestamp - native.timestamp) <= JS_MATCH_WINDOW_MS;

const pruneJs = (list: JsRequestSentEvent[], now: number): JsRequestSentEvent[] =>
  list.filter((entry) => now - entry.timestamp <= JS_RETENTION_MS);

const withRequest = (
  state: StoreState,
  requestId: string,
  update: (request: NetworkRequest) => NetworkRequest,
): StoreState => {
  const index = state.byId[requestId];
  if (index === undefined) return state;
  const requests = state.requests.slice();
  requests[index] = update(requests[index]);
  return { ...state, requests };
};

export const onJsRequestSent = (state: StoreState, event: JsRequestSentEvent): StoreState => {
  // A native "started" may already be here (native emits before the JS
  // hook's listener runs when the bridge is busy). Pair backwards first.
  for (let index = state.requests.length - 1; index >= 0; index -= 1) {
    const request = state.requests[index];
    if (request.origin !== 'unknown') continue;
    if (event.timestamp - request.startedAt > JS_MATCH_WINDOW_MS) break;
    if (
      request.method.toUpperCase() === event.method &&
      normaliseUrl(request.url) === normaliseUrl(event.url) &&
      Math.abs(request.startedAt - event.timestamp) <= JS_MATCH_WINDOW_MS
    ) {
      return withRequest(state, request.id, (current) => ({
        ...current,
        origin: 'js',
        jsApi: event.api,
      }));
    }
  }

  return {
    ...state,
    unmatchedJs: [...pruneJs(state.unmatchedJs, event.timestamp), event],
  };
};

export const onNativeRequestStarted = (
  state: StoreState,
  event: NativeRequestStartedEvent,
): StoreState => {
  if (state.byId[event.requestId] !== undefined) return state;

  const pending = pruneJs(state.unmatchedJs, event.timestamp);
  const jsIndex = pending.findIndex((js) => matchesJs(js, event));
  const js = jsIndex >= 0 ? pending[jsIndex] : null;
  if (jsIndex >= 0) pending.splice(jsIndex, 1);

  const request: NetworkRequest = {
    id: event.requestId,
    url: event.url,
    method: event.method.toUpperCase(),
    requestHeaders: event.headers ?? {},
    requestBody: event.body ?? null,
    startedAt: event.timestamp,
    platform: event.platform,
    transport: event.transport,
    client: event.client,
    origin: js ? 'js' : 'unknown',
    jsApi: js?.api,
    status: 'pending',
  };

  let requests = [...state.requests, request];
  let byId = { ...state.byId, [request.id]: requests.length - 1 };

  if (requests.length > MAX_REQUESTS) {
    requests = requests.slice(requests.length - MAX_REQUESTS);
    byId = {};
    requests.forEach((entry, index) => {
      byId[entry.id] = index;
    });
  }

  return { requests, byId, unmatchedJs: pending };
};

/**
 * Rows still `unknown` once their JS pairing window has closed are native-only
 * traffic. Called from the panel on a timer so labels settle without waiting
 * for the next event.
 */
export const settleOrigins = (state: StoreState, now: number): StoreState => {
  let changed = false;
  const requests = state.requests.map((request) => {
    if (request.origin === 'unknown' && now - request.startedAt > JS_MATCH_WINDOW_MS) {
      changed = true;
      return { ...request, origin: 'native' as const };
    }
    return request;
  });
  if (!changed) return state;
  return { ...state, requests };
};

export const onNativeResponseReceived = (
  state: StoreState,
  event: NativeResponseReceivedEvent,
): StoreState =>
  withRequest(state, event.requestId, (request) => ({
    ...request,
    httpStatus: event.status,
    statusText: event.statusText,
    responseHeaders: event.headers ?? {},
    mimeType: event.mimeType,
    finalUrl: event.url,
    protocol: event.protocol,
    fromCache: event.fromCache,
    responseAt: event.timestamp,
  }));

export const onNativeRequestCompleted = (
  state: StoreState,
  event: NativeRequestCompletedEvent,
): StoreState =>
  withRequest(state, event.requestId, (request) => ({
    ...request,
    status: 'completed',
    completedAt: event.timestamp,
    size: event.size,
    responseBody: event.body ?? null,
    protocol: event.protocol ?? request.protocol,
    fromCache: event.fromCache ?? request.fromCache,
  }));

export const onNativeRequestFailed = (
  state: StoreState,
  event: NativeRequestFailedEvent,
): StoreState =>
  withRequest(state, event.requestId, (request) => ({
    ...request,
    status: 'failed',
    completedAt: event.timestamp,
    error: event.error,
    canceled: event.canceled,
  }));

export const clearRequests = (state: StoreState): StoreState => ({
  ...state,
  requests: [],
  byId: {},
});

export type OriginFilter = 'all' | 'js' | 'native' | 'failed';

export const filterRequests = (
  requests: NetworkRequest[],
  query: string,
  origin: OriginFilter,
): NetworkRequest[] => {
  const needle = query.trim().toLowerCase();
  return requests.filter((request) => {
    if (origin === 'js' && request.origin !== 'js') return false;
    if (origin === 'native' && request.origin === 'js') return false;
    if (origin === 'failed' && request.status !== 'failed' && !(request.httpStatus && request.httpStatus >= 400)) {
      return false;
    }
    if (!needle) return true;
    return (
      request.url.toLowerCase().includes(needle) ||
      request.method.toLowerCase().includes(needle) ||
      (request.mimeType ?? '').toLowerCase().includes(needle) ||
      String(request.httpStatus ?? '').includes(needle)
    );
  });
};
