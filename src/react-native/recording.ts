import type { NativeNetworkEventMap } from '../shared/events';
import { EventQueue } from './event-queue';
import { installJsHook, setJsHookListener, uninstallJsHook } from './js-hook';
import { nativeNetwork, type NativeEvent } from './native-module';

export type NativeNetworkRecordingOptions = {
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
   * How many events to keep while DevTools is not connected.
   * @default 1000
   */
  queueSize?: number;
};

export const DEFAULT_RECORDING_OPTIONS: Required<NativeNetworkRecordingOptions> = {
  maxBodyBytes: 256 * 1024,
  trackJsOrigin: true,
  queueSize: 1000,
};

/**
 * Module-level recording state, shared by `withOnBootNativeNetworkRecording`
 * (index.js) and `useNativeNetworkDevTools` (component tree). Lives outside
 * React so a Fast Refresh of the component that calls the hook does not
 * lose what was captured before DevTools attached.
 */
type RecordingState = {
  queue: EventQueue<NativeNetworkEventMap> | null;
  options: Required<NativeNetworkRecordingOptions>;
  nativeSubscription: { remove: () => void } | null;
  isRecording: boolean;
  /** Set once `withOnBootNativeNetworkRecording` ran, so the hook does not override its options. */
  configuredAtBoot: boolean;
};

const state: RecordingState = {
  queue: null,
  options: DEFAULT_RECORDING_OPTIONS,
  nativeSubscription: null,
  isRecording: false,
  configuredAtBoot: false,
};

export const getRecordingQueue = (): EventQueue<NativeNetworkEventMap> => {
  if (!state.queue) {
    state.queue = new EventQueue<NativeNetworkEventMap>(state.options.queueSize);
  }
  return state.queue;
};

export const isRecording = (): boolean => state.isRecording;

export const wasConfiguredAtBoot = (): boolean => state.configuredAtBoot;

/**
 * Applies options. Boot-time configuration wins over hook options so the
 * two call sites cannot fight; the hook only fills in when boot never ran.
 */
export const configureRecording = (
  options: NativeNetworkRecordingOptions | undefined,
  { fromBoot }: { fromBoot: boolean },
): void => {
  if (!fromBoot && state.configuredAtBoot) {
    return;
  }
  state.options = { ...DEFAULT_RECORDING_OPTIONS, ...options };
  if (fromBoot) {
    state.configuredAtBoot = true;
  }
  if (state.isRecording && nativeNetwork.isAvailable()) {
    nativeNetwork.setMaxBodyBytes(state.options.maxBodyBytes);
  }
};

const forwardNativeEvent = (queue: EventQueue<NativeNetworkEventMap>, event: NativeEvent) => {
  const { type, ...payload } = event;
  switch (type) {
    case 'started':
      queue.send('native-request-started', payload as NativeNetworkEventMap['native-request-started']);
      return;
    case 'response':
      queue.send('native-response-received', payload as NativeNetworkEventMap['native-response-received']);
      return;
    case 'completed':
      queue.send('native-request-completed', payload as NativeNetworkEventMap['native-request-completed']);
      return;
    case 'failed':
      queue.send('native-request-failed', payload as NativeNetworkEventMap['native-request-failed']);
      return;
  }
};

export const startRecording = (): void => {
  if (state.isRecording) return;
  state.isRecording = true;

  const queue = getRecordingQueue();

  if (nativeNetwork.isAvailable()) {
    state.nativeSubscription?.remove();
    state.nativeSubscription = nativeNetwork.subscribe((event) => forwardNativeEvent(queue, event));
    nativeNetwork.setMaxBodyBytes(state.options.maxBodyBytes);
    // Flushes the native ring buffer (requests made before JS was ready).
    nativeNetwork.setEnabled(true);
  }

  if (state.options.trackJsOrigin) {
    setJsHookListener((event) => queue.send('js-request-sent', event));
    installJsHook();
  }
};

export const stopRecording = (): void => {
  if (!state.isRecording) return;
  state.isRecording = false;

  nativeNetwork.setEnabled(false);
  state.nativeSubscription?.remove();
  state.nativeSubscription = null;

  setJsHookListener(null);
  uninstallJsHook();
};

/** @internal test hook */
export const __resetRecordingState = (): void => {
  stopRecording();
  state.queue = null;
  state.options = DEFAULT_RECORDING_OPTIONS;
  state.configuredAtBoot = false;
};
