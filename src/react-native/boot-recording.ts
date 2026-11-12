import { configureRecording, startRecording, type NativeNetworkRecordingOptions } from './recording';

export type BootRecordingOptions = NativeNetworkRecordingOptions;

/**
 * Starts recording as soon as the JS bundle loads, before any component
 * mounts. Call it at the very top of `index.js`, ahead of imports that may
 * fire requests (analytics, auth refresh, config fetches):
 *
 * ```ts
 * import { withOnBootNativeNetworkRecording } from 'rozenite-native-network-plugin';
 * withOnBootNativeNetworkRecording();
 *
 * import { AppRegistry } from 'react-native';
 * import App from './App';
 * ```
 *
 * The native interceptors already buffer from process start; this flushes
 * that buffer right away, installs the XHR origin hook before the first JS
 * request, and queues everything until the DevTools panel connects.
 * `useNativeNetworkDevTools()` still has to be mounted somewhere so the
 * panel can attach; options passed here take precedence over the hook's.
 */
export const withOnBootNativeNetworkRecording = (options?: BootRecordingOptions): void => {
  configureRecording(options, { fromBoot: true });
  startRecording();
};
