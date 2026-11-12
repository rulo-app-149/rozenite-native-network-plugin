import { useEffect, useRef } from 'react';
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { PLUGIN_ID, type NativeNetworkEventMap } from '../shared/events';
import { EventQueue } from './event-queue';
import { installJsHook, setJsHookListener, uninstallJsHook } from './js-hook';
import { nativeNetwork, type NativeEvent } from './native-module';
import { getPlatform } from './native-module';

export type NativeNetworkDevToolsOptions = {
  /**
   * Maximum number of body bytes captured per request body and per response
   * body. Larger bodies are truncated (text) or reported as `too-large`.
   * @default 262144 (256 KiB)
   */
  maxBodyBytes?: number;
  /**
   * Also announce JavaScript-initiated requests so the panel can label rows
   * as "JS" or "Native". Disable if you patch `XMLHttpRequest` yourself.
   * @default true
   */
  trackJsOrigin?: boolean;
  /**
   * Start forwarding native events as soon as the app boots, before the
   * DevTools panel asks for them. Events are queued (up to `queueSize`)
   * until the panel connects.
   * @default true
   */
  captureOnBoot?: boolean;
  /**
   * How many events to keep while DevTools is not connected.
   * @default 1000
   */
  queueSize?: number;
};

const DEFAULTS: Required<NativeNetworkDevToolsOptions> = {
  maxBodyBytes: 256 * 1024,
  trackJsOrigin: true,
  captureOnBoot: true,
  queueSize: 1000,
};

// Module-level so a Fast Refresh of the component that calls the hook does
// not lose what was captured before DevTools attached.
let sharedQueue: EventQueue<NativeNetworkEventMap> | null = null;
let nativeSubscription: { remove: () => void } | null = null;
let isRecording = false;

const getQueue = (queueSize: number): EventQueue<NativeNetworkEventMap> => {
  if (!sharedQueue) {
    sharedQueue = new EventQueue<NativeNetworkEventMap>(queueSize);
  }
  return sharedQueue;
};

const forwardNativeEvent = (queue: EventQueue<NativeNetworkEventMap>, event: NativeEvent) => {
  switch (event.type) {
    case 'started': {
      const { type: _type, ...payload } = event;
      queue.send('native-request-started', payload);
      return;
    }
    case 'response': {
      const { type: _type, ...payload } = event;
      queue.send('native-response-received', payload);
      return;
    }
    case 'completed': {
      const { type: _type, ...payload } = event;
      queue.send('native-request-completed', payload);
      return;
    }
    case 'failed': {
      const { type: _type, ...payload } = event;
      queue.send('native-request-failed', payload);
      return;
    }
  }
};

const startCapture = (queue: EventQueue<NativeNetworkEventMap>, options: Required<NativeNetworkDevToolsOptions>) => {
  if (isRecording) return;
  isRecording = true;

  if (nativeNetwork.isAvailable()) {
    nativeSubscription?.remove();
    nativeSubscription = nativeNetwork.subscribe((event) => forwardNativeEvent(queue, event));
    nativeNetwork.setMaxBodyBytes(options.maxBodyBytes);
    // Flushes the native ring buffer (requests made before JS was ready).
    nativeNetwork.setEnabled(true);
  }

  if (options.trackJsOrigin) {
    setJsHookListener((event) => queue.send('js-request-sent', event));
    installJsHook();
  }
};

const stopCapture = () => {
  if (!isRecording) return;
  isRecording = false;

  nativeNetwork.setEnabled(false);
  nativeSubscription?.remove();
  nativeSubscription = null;

  setJsHookListener(null);
  uninstallJsHook();
};

/**
 * Mount once near the root of the app (dev builds only; the export is a
 * no-op in production). Streams every HTTP request the native networking
 * stacks see, JS-initiated or not, to the "Native Network" DevTools panel.
 */
export const useNativeNetworkDevTools = (options: NativeNetworkDevToolsOptions = {}) => {
  const resolved = { ...DEFAULTS, ...options };
  const optionsRef = useRef(resolved);
  optionsRef.current = resolved;

  const client = useRozeniteDevToolsClient<NativeNetworkEventMap>({ pluginId: PLUGIN_ID });

  // Capture from boot, independently of the DevTools connection.
  useEffect(() => {
    const queue = getQueue(optionsRef.current.queueSize);
    if (optionsRef.current.captureOnBoot) {
      startCapture(queue, optionsRef.current);
    }
  }, []);

  useEffect(() => {
    if (!client) return;

    const queue = getQueue(optionsRef.current.queueSize);

    const sendRecordingState = () => {
      client.send('recording-state', {
        isRecording,
        platform: getPlatform(),
        nativeModuleAvailable: nativeNetwork.isAvailable(),
      });
    };

    const subscriptions = [
      client.onMessage('enable', () => {
        startCapture(queue, optionsRef.current);
        queue.connect((type, payload) => client.send(type, payload));
        sendRecordingState();
      }),
      client.onMessage('disable', () => {
        stopCapture();
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
