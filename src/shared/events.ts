/**
 * Messages exchanged between the device side (`react-native.ts`) and the
 * DevTools panel (`src/ui/panel.tsx`) through `@rozenite/plugin-bridge`.
 *
 * The native interceptors (OkHttp on Android, NSURLSession on iOS) produce
 * the `native-*` events. The JS hook on `XMLHttpRequest` produces
 * `js-request-sent`, which the panel uses to tell JS-initiated traffic
 * (fetch / XHR / axios …) apart from traffic that never touched JavaScript
 * (image loaders, native SDKs, analytics, crash reporters …).
 */

export const PLUGIN_ID = 'rozenite-native-network-plugin';

export type Platform = 'android' | 'ios';

/** Which native stack recorded the request. */
export type Transport = 'okhttp' | 'nsurlsession';

/**
 * Where the native request was observed.
 * - `react-native-client`: React Native's own OkHttp client (Android). Carries
 *   fetch/XHR traffic as well as Fresco image loads.
 * - `custom-client`: an OkHttp client the app added the interceptor to by hand.
 * - `url-protocol`: the global `NSURLProtocol` on iOS, which sees every
 *   `NSURLSession` that uses a default / ephemeral configuration.
 */
export type NativeClientKind = 'react-native-client' | 'custom-client' | 'url-protocol';

export type Headers = Record<string, string>;

export type RequestBody =
  | { kind: 'text'; value: string; truncated: boolean; size: number }
  | { kind: 'binary'; size: number; contentType?: string }
  | { kind: 'stream' }
  | null;

export type ResponseBody =
  | { kind: 'text'; value: string; truncated: boolean; size: number }
  | { kind: 'base64'; value: string; truncated: boolean; size: number }
  | { kind: 'too-large'; size: number }
  | null;

export type NativeRequestStartedEvent = {
  requestId: string;
  url: string;
  method: string;
  headers: Headers;
  body: RequestBody;
  /** Epoch milliseconds. */
  timestamp: number;
  platform: Platform;
  transport: Transport;
  client: NativeClientKind;
};

export type NativeResponseReceivedEvent = {
  requestId: string;
  status: number;
  statusText: string;
  headers: Headers;
  mimeType: string;
  timestamp: number;
  /** Final URL after redirects, when it differs from the request URL. */
  url?: string;
  /** Protocol negotiated for the connection, e.g. `h2`, `http/1.1`. */
  protocol?: string;
  fromCache?: boolean;
};

export type NativeRequestCompletedEvent = {
  requestId: string;
  timestamp: number;
  /** Bytes of response body that reached the caller. */
  size: number;
  body: ResponseBody;
  /** iOS only: task metrics are collected after the response headers arrive. */
  protocol?: string;
  fromCache?: boolean;
};

export type NativeRequestFailedEvent = {
  requestId: string;
  timestamp: number;
  error: string;
  canceled: boolean;
};

export type JsRequestSentEvent = {
  jsId: string;
  url: string;
  method: string;
  timestamp: number;
  /** `fetch` when the XHR was created by React Native's fetch polyfill. */
  api: 'fetch' | 'xhr';
};

export type RecordingStateEvent = {
  isRecording: boolean;
  platform: Platform | 'unknown';
  /** False when the native module is not linked (pod not installed, app not rebuilt …). */
  nativeModuleAvailable: boolean;
};

export type NativeNetworkEventMap = {
  // Panel -> device
  enable: Record<string, never>;
  disable: Record<string, never>;
  'get-recording-state': Record<string, never>;

  // Device -> panel
  'recording-state': RecordingStateEvent;
  'native-request-started': NativeRequestStartedEvent;
  'native-response-received': NativeResponseReceivedEvent;
  'native-request-completed': NativeRequestCompletedEvent;
  'native-request-failed': NativeRequestFailedEvent;
  'js-request-sent': JsRequestSentEvent;
};

export type NativeNetworkEventName = keyof NativeNetworkEventMap;

export const DEVICE_TO_PANEL_EVENTS = [
  'recording-state',
  'native-request-started',
  'native-response-received',
  'native-request-completed',
  'native-request-failed',
  'js-request-sent',
] as const satisfies readonly NativeNetworkEventName[];
