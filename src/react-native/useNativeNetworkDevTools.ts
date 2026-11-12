import { useEffect, useRef } from 'react';
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { PLUGIN_ID, type NativeNetworkEventMap } from '../shared/events';
import { getPlatform, nativeNetwork } from './native-module';
import {
  configureRecording,
  getRecordingQueue,
  isRecording,
  startRecording,
  stopRecording,
  type NativeNetworkRecordingOptions,
} from './recording';

export type NativeNetworkDevToolsOptions = NativeNetworkRecordingOptions & {
  /**
   * Start recording when the hook mounts, before the DevTools panel asks
   * for it. Events are queued (up to `queueSize`) until the panel connects.
   * Ignored when `withOnBootNativeNetworkRecording()` already started it.
   * @default true
   */
  captureOnBoot?: boolean;
};

/**
 * Mount once near the root of the app (dev builds only; the export is a
 * no-op in production). Streams every HTTP request the native networking
 * stacks see, JS-initiated or not, to the "Native Network" DevTools panel.
 *
 * To start recording before any component mounts, call
 * `withOnBootNativeNetworkRecording()` at the top of `index.js` as well.
 */
export const useNativeNetworkDevTools = (options: NativeNetworkDevToolsOptions = {}) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const client = useRozeniteDevToolsClient<NativeNetworkEventMap>({ pluginId: PLUGIN_ID });

  // Capture from mount, independently of the DevTools connection. A no-op
  // when boot recording already configured and started everything.
  useEffect(() => {
    const { captureOnBoot = true, ...recordingOptions } = optionsRef.current;
    configureRecording(recordingOptions, { fromBoot: false });
    if (captureOnBoot) {
      startRecording();
    }
  }, []);

  useEffect(() => {
    if (!client) return;

    const queue = getRecordingQueue();

    const sendRecordingState = () => {
      client.send('recording-state', {
        isRecording: isRecording(),
        platform: getPlatform(),
        nativeModuleAvailable: nativeNetwork.isAvailable(),
      });
    };

    const subscriptions = [
      client.onMessage('enable', () => {
        startRecording();
        queue.connect((type, payload) => client.send(type, payload));
        sendRecordingState();
      }),
      client.onMessage('disable', () => {
        stopRecording();
        queue.disconnect();
        sendRecordingState();
      }),
      client.onMessage('get-recording-state', sendRecordingState),
    ];

    // Tell the panel what it is dealing with (platform, whether the pod /
    // gradle module is linked) as soon as it connects.
    sendRecordingState();

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      queue.disconnect();
    };
  }, [client]);

  return client;
};
