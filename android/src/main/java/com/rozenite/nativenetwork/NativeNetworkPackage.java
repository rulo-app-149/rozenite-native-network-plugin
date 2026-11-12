package com.rozenite.nativenetwork;

import androidx.annotation.NonNull;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.Collections;
import java.util.List;

public class NativeNetworkPackage implements ReactPackage {

  @NonNull
  @Override
  public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext context) {
    // Packages are processed before React Native instantiates its
    // NetworkingModule, so the OkHttp factory is in place in time for the
    // very first fetch. (Re-running from MainApplication is harmless.)
    NativeNetworkInterceptor.install(context);
    return Collections.<NativeModule>singletonList(new NativeNetworkModule(context));
  }

  @NonNull
  @Override
  public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext context) {
    return Collections.emptyList();
  }
}
