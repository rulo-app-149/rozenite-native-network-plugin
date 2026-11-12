package com.rozenite.nativenetwork;

import androidx.annotation.Nullable;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Process-wide sink for the events the interceptor produces.
 *
 * <p>Events are kept in a ring buffer until a {@link Listener} (the React
 * module) attaches, so traffic that happens before the JS side is ready (the
 * first bundle fetch, boot-time SDK calls, splash-screen images) is not lost.
 */
public final class NativeNetworkRecorder {

  public interface Listener {
    void onEvent(Map<String, Object> event);
  }

  private static final int MAX_BUFFERED_EVENTS = 500;

  private static final NativeNetworkRecorder INSTANCE = new NativeNetworkRecorder();

  private final ArrayDeque<Map<String, Object>> buffer = new ArrayDeque<>();
  private final AtomicBoolean capturing = new AtomicBoolean(true);
  private volatile int maxBodyBytes = 256 * 1024;
  @Nullable private Listener listener;

  private NativeNetworkRecorder() {}

  public static NativeNetworkRecorder getInstance() {
    return INSTANCE;
  }

  /** Whether the interceptor should record at all. */
  public boolean isCapturing() {
    return capturing.get();
  }

  public void setCapturing(boolean enabled) {
    capturing.set(enabled);
  }

  public int getMaxBodyBytes() {
    return maxBodyBytes;
  }

  public void setMaxBodyBytes(int bytes) {
    maxBodyBytes = Math.max(0, bytes);
  }

  public synchronized void setListener(@Nullable Listener next) {
    listener = next;
    if (next != null) {
      flushTo(next);
    }
  }

  public synchronized void clearBuffer() {
    buffer.clear();
  }

  /** Called from OkHttp threads. */
  public void emit(Map<String, Object> event) {
    if (!capturing.get()) {
      return;
    }
    Listener target;
    synchronized (this) {
      target = listener;
      if (target == null) {
        if (buffer.size() >= MAX_BUFFERED_EVENTS) {
          buffer.pollFirst();
        }
        buffer.addLast(event);
        return;
      }
    }
    target.onEvent(event);
  }

  private void flushTo(Listener target) {
    List<Map<String, Object>> pending = new ArrayList<>(buffer);
    buffer.clear();
    for (Map<String, Object> event : pending) {
      target.onEvent(event);
    }
  }
}
