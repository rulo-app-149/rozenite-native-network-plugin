/**
 * App-side entry point for rozenite-native-network-plugin.
 *
 * - `withOnBootNativeNetworkRecording()`: call at the top of `index.js` to
 *   record from the moment the bundle loads.
 * - `useNativeNetworkDevTools()`: mount once near the root of the app so
 *   the DevTools panel can attach.
 *
 * In production bundles, on the web and on the server both exports are
 * replaced by no-ops so nothing from `src/react-native` is pulled in.
 */

export type { NativeNetworkDevToolsOptions } from './src/react-native/useNativeNetworkDevTools';
export type { BootRecordingOptions } from './src/react-native/boot-recording';
export type { NativeNetworkRecordingOptions } from './src/react-native/recording';
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
export let withOnBootNativeNetworkRecording: typeof import('./src/react-native/boot-recording').withOnBootNativeNetworkRecording;

const isWeb = typeof window !== 'undefined' && window.navigator.product !== 'ReactNative';
const isServer = typeof window === 'undefined';
const isDev = process.env.NODE_ENV !== 'production';

if (isDev && !isWeb && !isServer) {
  useNativeNetworkDevTools =
    require('./src/react-native/useNativeNetworkDevTools').useNativeNetworkDevTools;
  withOnBootNativeNetworkRecording =
    require('./src/react-native/boot-recording').withOnBootNativeNetworkRecording;
} else {
  useNativeNetworkDevTools = () => null;
  withOnBootNativeNetworkRecording = () => undefined;
}
