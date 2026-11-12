import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMock = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    available: true,
    setEnabled: vi.fn(),
    setMaxBodyBytes: vi.fn(),
    clearBuffer: vi.fn(),
    isAvailable: () => nativeMock.available,
    subscribe: (listener: (event: unknown) => void) => {
      listeners.push(listener);
      return {
        remove: () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      };
    },
  };
});

vi.mock('../native-module', () => ({
  nativeNetwork: nativeMock,
  getPlatform: () => 'android',
  isNativeModuleAvailable: () => nativeMock.available,
}));

import { withOnBootNativeNetworkRecording } from '../boot-recording';
import {
  __resetRecordingState,
  configureRecording,
  getRecordingQueue,
  isRecording,
  startRecording,
  stopRecording,
} from '../recording';

class FakeXhr {
  open(_method: string, _url: string) {}
  send() {}
}

describe('boot recording', () => {
  beforeEach(() => {
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    nativeMock.available = true;
    nativeMock.setEnabled.mockClear();
    nativeMock.setMaxBodyBytes.mockClear();
  });

  afterEach(() => {
    __resetRecordingState();
    delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  });

  it('starts native capture and the XHR hook immediately', () => {
    const originalOpen = FakeXhr.prototype.open;
    withOnBootNativeNetworkRecording({ maxBodyBytes: 1024 });

    expect(isRecording()).toBe(true);
    expect(nativeMock.setMaxBodyBytes).toHaveBeenCalledWith(1024);
    expect(nativeMock.setEnabled).toHaveBeenCalledWith(true);
    expect(nativeMock.listeners).toHaveLength(1);
    expect(FakeXhr.prototype.open).not.toBe(originalOpen);
  });

  it('queues native and JS events until a sink connects, in order', () => {
    withOnBootNativeNetworkRecording();
    const queue = getRecordingQueue();

    nativeMock.listeners[0]({
      type: 'started',
      requestId: 'n-1',
      url: 'https://example.com/boot',
      method: 'GET',
      headers: {},
      body: null,
      timestamp: 1,
      platform: 'android',
      transport: 'okhttp',
      client: 'react-native-client',
    });
    const xhr = new FakeXhr();
    xhr.open('POST', 'https://example.com/js');
    xhr.send();
    nativeMock.listeners[0]({ type: 'completed', requestId: 'n-1', timestamp: 2, size: 0, body: null });

    expect(queue.size()).toBe(3);

    const received: string[] = [];
    queue.connect((type) => received.push(String(type)));

    expect(received).toEqual(['native-request-started', 'js-request-sent', 'native-request-completed']);
    expect(queue.size()).toBe(0);
  });

  it('lets boot options win over hook options', () => {
    withOnBootNativeNetworkRecording({ maxBodyBytes: 1024 });
    configureRecording({ maxBodyBytes: 4096 }, { fromBoot: false });

    expect(nativeMock.setMaxBodyBytes).toHaveBeenLastCalledWith(1024);
  });

  it('is idempotent and survives a second start', () => {
    withOnBootNativeNetworkRecording();
    startRecording();
    withOnBootNativeNetworkRecording();

    expect(nativeMock.listeners).toHaveLength(1);
    expect(nativeMock.setEnabled).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly and restores XMLHttpRequest', () => {
    const originalSend = FakeXhr.prototype.send;
    withOnBootNativeNetworkRecording();
    expect(FakeXhr.prototype.send).not.toBe(originalSend);

    stopRecording();

    expect(isRecording()).toBe(false);
    expect(nativeMock.setEnabled).toHaveBeenLastCalledWith(false);
    expect(nativeMock.listeners).toHaveLength(0);
    expect(FakeXhr.prototype.send).toBe(originalSend);
  });

  it('still records JS announcements when the native module is missing', () => {
    nativeMock.available = false;
    withOnBootNativeNetworkRecording();
    const queue = getRecordingQueue();

    const xhr = new FakeXhr();
    xhr.open('GET', 'https://example.com/only-js');
    xhr.send();

    expect(nativeMock.setEnabled).not.toHaveBeenCalled();
    expect(queue.size()).toBe(1);
  });
});
