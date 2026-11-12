import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type {
  NativeRequestCompletedEvent,
  NativeRequestFailedEvent,
  NativeRequestStartedEvent,
  NativeResponseReceivedEvent,
  Platform as PluginPlatform,
} from '../shared/events';

/** Name the module registers under on both platforms. */
export const NATIVE_MODULE_NAME = 'RozeniteNativeNetwork';

/** Single event the native side emits; `type` discriminates the payload. */
export const NATIVE_EVENT_NAME = 'RozeniteNativeNetwork';

export type NativeEvent =
  | ({ type: 'started' } & NativeRequestStartedEvent)
  | ({ type: 'response' } & NativeResponseReceivedEvent)
  | ({ type: 'completed' } & NativeRequestCompletedEvent)
  | ({ type: 'failed' } & NativeRequestFailedEvent);

type NativeNetworkModuleSpec = {
  /**
   * Starts (or stops) forwarding events to JS. Enabling also flushes
   * everything the native ring buffer captured since app start.
   */
  setEnabled: (enabled: boolean) => void;
  /** Caps how many body bytes are captured per request / response. */
  setMaxBodyBytes: (bytes: number) => void;
  /** Drops the buffered events without disabling capture. */
  clearBuffer: () => void;
  // Required by NativeEventEmitter on iOS.
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

const getNativeModule = (): NativeNetworkModuleSpec | null => {
  const module = NativeModules[NATIVE_MODULE_NAME] as NativeNetworkModuleSpec | undefined;
  return module ?? null;
};

export const isNativeModuleAvailable = (): boolean => getNativeModule() !== null;

export const getPlatform = (): PluginPlatform | 'unknown' => {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    return Platform.OS;
  }
  return 'unknown';
};

export type NativeNetworkSubscription = { remove: () => void };

/**
 * Thin wrapper over the native module so the hook never touches
 * `NativeModules` directly and tests can substitute it.
 */
export const nativeNetwork = {
  isAvailable: isNativeModuleAvailable,

  setEnabled(enabled: boolean): void {
    getNativeModule()?.setEnabled(enabled);
  },

  setMaxBodyBytes(bytes: number): void {
    getNativeModule()?.setMaxBodyBytes(bytes);
  },

  clearBuffer(): void {
    getNativeModule()?.clearBuffer();
  },

  subscribe(listener: (event: NativeEvent) => void): NativeNetworkSubscription {
    const module = getNativeModule();
    if (!module) {
      return { remove: () => undefined };
    }

    // On Android the emitter argument is ignored; on iOS it must be the
    // module so `addListener` / `removeListeners` are routed to it.
    const emitter = new NativeEventEmitter(
      Platform.OS === 'ios'
        ? (module as unknown as ConstructorParameters<typeof NativeEventEmitter>[0])
        : undefined,
    );
    const subscription = emitter.addListener(NATIVE_EVENT_NAME, (event: NativeEvent) => {
      listener(event);
    });

    return { remove: () => subscription.remove() };
  },
};
