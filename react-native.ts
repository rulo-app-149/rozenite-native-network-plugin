/**
 * App-side entry point for rozenite-native-network-plugin.
 *
 * Call `useNativeNetworkDevTools()` once near the root of your app. In
 * production bundles, on the web and on the server the export is replaced
 * by a no-op so nothing from `src/react-native` is pulled in.
 */

export type { NativeNetworkDevToolsOptions } from './src/react-native/useNativeNetworkDevTools';
export type {
  NativeNetworkEventMap,
  NativeRequestStartedEvent,
  NativeResponseReceivedEvent,
  NativeRequestCompletedEvent,
  NativeRequestFailedEvent,
  JsRequestSentEvent,
  RecordingStateEvent,
} from './src/shared/events';

export let useNativeNetworkDevTools: typeof import('./src/react-native/useNativeNetworkDevTools').useNativeNetworkDevTools;

const isWeb = typeof window !== 'undefined' && window.navigator.product !== 'ReactNative';
const isServer = typeof window === 'undefined';
const isDev = process.env.NODE_ENV !== 'production';

if (isDev && !isWeb && !isServer) {
  useNativeNetworkDevTools =
    require('./src/react-native/useNativeNetworkDevTools').useNativeNetworkDevTools;
} else {
  useNativeNetworkDevTools = () => null;
}
