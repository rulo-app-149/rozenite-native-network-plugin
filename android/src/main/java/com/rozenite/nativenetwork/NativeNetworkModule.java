package com.rozenite.nativenetwork;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.Map;

/**
 * Bridges {@link NativeNetworkRecorder} to JavaScript. Legacy-style module so
 * it works on the old architecture and, through the interop layer, on the new
 * one without codegen.
 */
public class NativeNetworkModule extends ReactContextBaseJavaModule implements NativeNetworkRecorder.Listener {

  public static final String NAME = "RozeniteNativeNetwork";
  private static final String EVENT_NAME = "RozeniteNativeNetwork";

  public NativeNetworkModule(ReactApplicationContext context) {
    super(context);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @Override
  public void invalidate() {
    NativeNetworkRecorder.getInstance().setListener(null);
    super.invalidate();
  }

  @ReactMethod
  public void setEnabled(boolean enabled) {
    NativeNetworkRecorder recorder = NativeNetworkRecorder.getInstance();
    recorder.setCapturing(enabled);
    // Attaching flushes whatever was buffered before JS was ready.
    recorder.setListener(enabled ? this : null);
  }

  @ReactMethod
  public void setMaxBodyBytes(double bytes) {
    NativeNetworkRecorder.getInstance().setMaxBodyBytes((int) bytes);
  }

  @ReactMethod
  public void clearBuffer() {
    NativeNetworkRecorder.getInstance().clearBuffer();
  }

  @ReactMethod
  public void addListener(String eventName) {
    // Required by NativeEventEmitter; nothing to do.
  }

  @ReactMethod
  public void removeListeners(double count) {
    // Required by NativeEventEmitter; nothing to do.
  }

  @Override
  public void onEvent(Map<String, Object> event) {
    ReactApplicationContext context = getReactApplicationContext();
    if (!context.hasActiveReactInstance()) {
      return;
    }
    WritableMap payload = Arguments.makeNativeMap(event);
    context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
        .emit(EVENT_NAME, payload);
  }
}
