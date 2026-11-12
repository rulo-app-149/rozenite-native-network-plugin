/* eslint-disable prefer-rest-params */
import type { JsRequestSentEvent } from '../shared/events';

/**
 * Patches `XMLHttpRequest.prototype.open` / `send` so every request that
 * originates in JavaScript is announced with a `js-request-sent` event.
 *
 * React Native's `fetch` is `whatwg-fetch`, which builds and sends an XHR
 * synchronously inside the `fetch()` call, so hooking XHR covers fetch,
 * axios, `react-native-sse` and friends in one place. The panel pairs these
 * announcements with the native events to label each row "JS" or "Native".
 *
 * Nothing about the request is altered: no headers are added and the
 * original methods are always called with the original arguments.
 */

type XhrMeta = { method: string; url: string };

type Listener = (event: JsRequestSentEvent) => void;

const pendingMeta = new WeakMap<XMLHttpRequest, XhrMeta>();

let installed: {
  open: typeof XMLHttpRequest.prototype.open;
  send: typeof XMLHttpRequest.prototype.send;
  fetch: typeof globalThis.fetch | undefined;
} | null = null;

let listener: Listener | null = null;
let counter = 0;
let activeFetchDepth = 0;

const getXhrCtor = (): typeof XMLHttpRequest | null => {
  const ctor = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  return typeof ctor === 'function' ? ctor : null;
};

export const isJsHookInstalled = (): boolean => installed !== null;

export const setJsHookListener = (next: Listener | null): void => {
  listener = next;
};

export const installJsHook = (): void => {
  if (installed) return;

  const XHR = getXhrCtor();
  if (!XHR) return;

  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;
  const originalFetch = globalThis.fetch;

  XHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
    pendingMeta.set(this, { method: String(method).toUpperCase(), url: String(url) });
    // @ts-expect-error forwarding the original arguments untouched
    return originalOpen.apply(this, arguments);
  };

  XHR.prototype.send = function (this: XMLHttpRequest) {
    const meta = pendingMeta.get(this);
    if (meta && listener) {
      counter += 1;
      listener({
        jsId: `js-${Date.now()}-${counter}`,
        url: meta.url,
        method: meta.method,
        timestamp: Date.now(),
        api: activeFetchDepth > 0 ? 'fetch' : 'xhr',
      });
    }
    // @ts-expect-error forwarding the original arguments untouched
    return originalSend.apply(this, arguments);
  };

  if (typeof originalFetch === 'function') {
    // Only used to tell `fetch` from a hand-made XHR; whatwg-fetch sends the
    // XHR synchronously inside this call frame.
    globalThis.fetch = function (this: unknown) {
      activeFetchDepth += 1;
      try {
        // @ts-expect-error forwarding the original arguments untouched
        return originalFetch.apply(this, arguments);
      } finally {
        activeFetchDepth -= 1;
      }
    } as typeof globalThis.fetch;
  }

  installed = { open: originalOpen, send: originalSend, fetch: originalFetch };
};

export const uninstallJsHook = (): void => {
  if (!installed) return;

  const XHR = getXhrCtor();
  if (XHR) {
    XHR.prototype.open = installed.open;
    XHR.prototype.send = installed.send;
  }
  if (installed.fetch) {
    globalThis.fetch = installed.fetch;
  }
  installed = null;
};
