# rozenite-native-network-plugin

A [Rozenite](https://github.com/callstackincubator/rozenite) plugin for React Native DevTools that shows **every HTTP request the app makes, including the ones that never go through JavaScript**.

The official `@rozenite/network-activity-plugin` hooks `fetch` / `XMLHttpRequest` inside the JS runtime, so it cannot see traffic issued by native code: `<Image>` loads (Fresco / SDWebImage), analytics and crash-reporting SDKs, push and config fetches, maps tiles, native auth flows, and so on. This plugin hooks the native networking stacks instead:

| Platform | Hook | What it sees |
| --- | --- | --- |
| Android | OkHttp `Interceptor` installed on React Native's shared `OkHttpClient` via `OkHttpClientProvider` | fetch / XHR / axios, Fresco image loads, anything else using RN's client. Other OkHttp clients can opt in with one line (see below). |
| iOS | `NSURLProtocol` registered globally and prepended to the `protocolClasses` of every default / ephemeral `NSURLSessionConfiguration` | RCTNetworking (fetch / XHR), `NSURLSession.sharedSession`, image loaders, most third-party SDKs. |

Each row is labelled **JS** (fetch or XHR, matched against a lightweight XHR hook) or **Native** (no JavaScript involved), and the detail pane shows headers, request / response bodies (text, JSON pretty-printed, image preview), timing and a **Copy as cURL** button.

> Dev builds only. The React Native entry point is a no-op in production bundles, the Android hook only installs in debuggable builds, and the iOS hook only installs when `DEBUG` is defined.

## Installation

```bash
npm install --save-dev rozenite-native-network-plugin
```

Then rebuild the app so the native module is linked (autolinking handles both platforms):

```bash
cd ios && pod install && cd ..
```

Mount the hook once, near the root of your app:

```tsx
import { useNativeNetworkDevTools } from 'rozenite-native-network-plugin';

export default function App() {
  useNativeNetworkDevTools();
  return <Navigation />;
}
```

Open React Native DevTools (press `j` in the Metro terminal). A **Native Network** panel appears in the sidebar. Requests made before the panel was opened are buffered on the device (up to 500 natively, 1000 in JS) and flushed when it connects, so boot-time traffic is visible too.

### Record from the moment `index.js` loads

The hook above starts recording when the root component mounts. To catch everything that happens between bundle load and first render (analytics init, auth refresh, remote config, requests fired by imported modules), call `withOnBootNativeNetworkRecording()` at the very top of `index.js`, before any other import that could make a request:

```ts
import { withOnBootNativeNetworkRecording } from 'rozenite-native-network-plugin';

withOnBootNativeNetworkRecording();

import { AppRegistry } from 'react-native';
import App from './App';
```

This flushes the native buffer right away, installs the XHR origin hook before the first JS request, and queues events until the panel connects. `useNativeNetworkDevTools()` still has to be mounted somewhere so the panel can attach. Options passed to `withOnBootNativeNetworkRecording` take precedence over the hook's. The native interceptors themselves are active from process start regardless (installed when the Android package is registered and at iOS class-load time), so requests before `index.js` even runs are captured too.

Rozenite itself has to be set up in the app (`@rozenite/metro` or `@rozenite/repack`). See the [Rozenite getting started guide](https://www.rozenite.dev/docs/getting-started).

### Options

```tsx
useNativeNetworkDevTools({
  // Body bytes captured per request body and per response body.
  maxBodyBytes: 256 * 1024,
  // Announce JS-initiated requests so rows can be labelled JS vs Native.
  trackJsOrigin: true,
  // Start recording when the hook mounts, before DevTools is opened.
  // Ignored when withOnBootNativeNetworkRecording() already started it.
  captureOnBoot: true,
  // Events kept on the JS side while DevTools is not connected.
  queueSize: 1000,
});
```

`withOnBootNativeNetworkRecording` accepts the same options except `captureOnBoot`.

### Android: covering OkHttp clients you create yourself

React Native's shared client is hooked automatically. For an `OkHttpClient` the app or a native SDK builds on its own, add the interceptor to its builder:

```java
import com.rozenite.nativenetwork.NativeNetworkInterceptor;

OkHttpClient client = new OkHttpClient.Builder()
    .addInterceptor(NativeNetworkInterceptor.forCustomClient())
    .build();
```

Those rows show up with the transport `OkHttp (custom client)`.

If something in your `MainApplication` sets its own `OkHttpClientFactory`, call `NativeNetworkInterceptor.install(this)` **after** it, or add `forCustomClient()` to your factory's builder. The plugin's own factory is installed when the package is registered and never overrides one set later.

### iOS: sessions with a custom configuration

The `NSURLProtocol` is prepended to `protocolClasses` of every `NSURLSessionConfiguration` created after the hook is installed (at class-load time in DEBUG builds). A session whose configuration replaces `protocolClasses` afterwards will not be observed; add `RNNURLProtocol.class` to that array to opt it in.

If your Debug configuration does not define `DEBUG` for pods, call `[RozeniteNativeNetwork install]` from `application:didFinishLaunchingWithOptions:`.

## How JS vs Native labelling works

The device side patches `XMLHttpRequest.prototype.open` / `send` (React Native's `fetch` is built on XHR, so this covers fetch, axios, `react-native-sse` …) and announces each JS request as `{ url, method, timestamp }`. Nothing about the request is changed, no headers are added. The panel pairs an announcement with the native request that has the same method and URL within a 5 s window. Rows that never get a match settle to **Native** once the window closes. Until then they show as `Native?`.

## Limitations

- **Android**: only OkHttp traffic is visible. `HttpURLConnection`, Cronet, WebView and raw sockets are not intercepted. OkHttp clients outside React Native's shared one need the one-line opt-in above.
- **iOS**: `NSURLProtocol` cannot see traffic from `WKWebView`, Network.framework, or sessions with a background configuration. Requests are replayed on a default session, so a custom session's timeouts and cache policy do not apply to the replay. Streamed request bodies larger than 10 MB are not captured.
- Bodies are captured up to `maxBodyBytes` (256 KiB by default). Larger text bodies are truncated, larger binary bodies are reported as `too-large`.
- WebSocket and SSE frames are not decoded (the HTTP upgrade / initial request is still listed).

## Development

```bash
npm install
npm run dev        # Rozenite dev host with sample traffic on http://localhost:8888
npm test           # store / pairing logic
npm run typecheck
npm run build      # dist/ with panel bundle, RN entry point and rozenite.json
```

To try it in a real app, link the package and start Metro with `ROZENITE_DEV_MODE=rozenite-native-network-plugin` so the panel is served from the dev server. The native code must be compiled into the app (`pod install` / gradle sync) for native events to flow. Without it the panel shows a banner and only JS announcements arrive.

## Project layout

```
react-native.ts                 app-side entry (no-op outside dev / RN)
src/react-native/               hook, boot recording, native module binding, XHR hook, event queue
src/shared/events.ts            event schema shared by device and panel
src/ui/                         DevTools panel (store, formatting, React UI)
android/                        OkHttp interceptor + bridge module
ios/                            NSURLProtocol, session-configuration swizzle, bridge module
rozenite.config.ts              panel registration + dev host fixtures
```

## License

MIT
