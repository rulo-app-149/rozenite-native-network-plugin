package com.rozenite.nativenetwork;

import android.content.pm.ApplicationInfo;
import android.content.Context;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.modules.network.OkHttpClientFactory;
import com.facebook.react.modules.network.OkHttpClientProvider;

import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.Headers;
import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;
import okio.ForwardingSource;
import okio.Okio;
import okio.Source;

/**
 * OkHttp {@link Interceptor} that reports every request to
 * {@link NativeNetworkRecorder}.
 *
 * <p>{@link #install(Context)} registers an {@link OkHttpClientFactory} with
 * React Native's {@link OkHttpClientProvider}, which is the client used by
 * fetch / XHR <em>and</em> by Fresco for {@code <Image>} loads. Other OkHttp
 * clients the app or its native SDKs create on their own can be covered by
 * adding {@link #forClient(String)} to their builders.
 *
 * <p>The response body is captured as the app consumes it (a tee on the
 * source) rather than read up-front, so streaming responses are not blocked
 * and the "completed" event carries the real number of bytes delivered.
 */
public final class NativeNetworkInterceptor implements Interceptor {

  private static final AtomicBoolean INSTALLED = new AtomicBoolean(false);

  private final String clientKind;

  private NativeNetworkInterceptor(String clientKind) {
    this.clientKind = clientKind;
  }

  /**
   * Interceptor for an OkHttp client the app (or one of its native SDKs)
   * builds itself, so its traffic shows up next to React Native's:
   *
   * <pre>{@code
   * new OkHttpClient.Builder()
   *     .addInterceptor(NativeNetworkInterceptor.forCustomClient())
   *     .build();
   * }</pre>
   */
  public static NativeNetworkInterceptor forCustomClient() {
    return new NativeNetworkInterceptor("custom-client");
  }

  /**
   * Hooks React Native's shared OkHttp client. Safe to call several times.
   * Only active in debuggable builds; a no-op in release builds.
   *
   * <p>Must run before React Native creates its networking module, which is
   * why {@link NativeNetworkPackage} calls it when the package is
   * registered. Calling it again from {@code MainApplication.onCreate()} is
   * harmless and makes sure nothing else creates the client first.
   */
  public static void install(@NonNull Context context) {
    if (!isDebuggable(context)) {
      return;
    }
    INSTALLED.set(true);

    // (Re)registering is cheap and deliberately not guarded: an app that
    // set its own factory after the package was registered can call this
    // again to put the plugin's factory back on top.
    final NativeNetworkInterceptor interceptor = new NativeNetworkInterceptor("react-native-client");
    OkHttpClientProvider.setOkHttpClientFactory(
        new OkHttpClientFactory() {
          @Override
          public OkHttpClient createNewNetworkModuleClient() {
            return OkHttpClientProvider.createClientBuilder()
                .addInterceptor(interceptor)
                .build();
          }
        });
  }

  public static boolean isInstalled() {
    return INSTALLED.get();
  }

  private static boolean isDebuggable(Context context) {
    ApplicationInfo info = context.getApplicationInfo();
    return info != null && (info.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
  }

  @NonNull
  @Override
  public Response intercept(@NonNull Chain chain) throws IOException {
    final NativeNetworkRecorder recorder = NativeNetworkRecorder.getInstance();
    final Request request = chain.request();

    if (!recorder.isCapturing()) {
      return chain.proceed(request);
    }

    final String requestId = UUID.randomUUID().toString();
    final long startedAt = System.currentTimeMillis();

    Map<String, Object> started = new HashMap<>();
    started.put("type", "started");
    started.put("requestId", requestId);
    started.put("url", request.url().toString());
    started.put("method", request.method());
    started.put("headers", headersToMap(request.headers()));
    started.put("body", describeRequestBody(request.body(), recorder.getMaxBodyBytes()));
    started.put("timestamp", (double) startedAt);
    started.put("platform", "android");
    started.put("transport", "okhttp");
    started.put("client", clientKind);
    recorder.emit(started);

    final Response response;
    try {
      response = chain.proceed(request);
    } catch (IOException | RuntimeException error) {
      recorder.emit(failedEvent(requestId, error));
      throw error;
    }

    Map<String, Object> received = new HashMap<>();
    received.put("type", "response");
    received.put("requestId", requestId);
    received.put("status", (double) response.code());
    received.put("statusText", response.message());
    received.put("headers", headersToMap(response.headers()));
    received.put("mimeType", response.header("Content-Type", ""));
    received.put("timestamp", (double) System.currentTimeMillis());
    received.put("url", response.request().url().toString());
    received.put("protocol", response.protocol().toString());
    received.put("fromCache", response.cacheResponse() != null && response.networkResponse() == null);
    recorder.emit(received);

    ResponseBody body = response.body();
    if (body == null) {
      recorder.emit(completedEvent(requestId, 0, null));
      return response;
    }

    MediaType contentType = body.contentType();
    boolean textual = isTextual(contentType, response.header("Content-Type"));
    Charset charset = contentType != null && contentType.charset() != null
        ? contentType.charset()
        : StandardCharsets.UTF_8;

    TeeSource tee = new TeeSource(body.source(), requestId, recorder, textual, charset);
    ResponseBody wrapped = ResponseBody.create(Okio.buffer(tee), contentType, body.contentLength());

    return response.newBuilder().body(wrapped).build();
  }

  // --- helpers -----------------------------------------------------------

  private static Map<String, Object> headersToMap(Headers headers) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < headers.size(); i++) {
      String name = headers.name(i).toLowerCase(Locale.US);
      String value = headers.value(i);
      Object existing = map.get(name);
      map.put(name, existing == null ? value : existing + ", " + value);
    }
    return map;
  }

  @Nullable
  private static Map<String, Object> describeRequestBody(@Nullable RequestBody body, int maxBytes) {
    if (body == null) {
      return null;
    }
    Map<String, Object> described = new HashMap<>();
    try {
      if (body.isOneShot() || body.isDuplex()) {
        described.put("kind", "stream");
        return described;
      }
      MediaType type = body.contentType();
      long length = body.contentLength();
      boolean textual = isTextual(type, type == null ? null : type.toString());
      if (!textual) {
        described.put("kind", "binary");
        described.put("size", (double) Math.max(0, length));
        if (type != null) {
          described.put("contentType", type.toString());
        }
        return described;
      }
      Buffer buffer = new Buffer();
      body.writeTo(buffer);
      long size = buffer.size();
      Charset charset = type != null && type.charset() != null ? type.charset() : StandardCharsets.UTF_8;
      boolean truncated = size > maxBytes;
      String text = truncated
          ? buffer.readString(maxBytes, charset)
          : buffer.readString(charset);
      described.put("kind", "text");
      described.put("value", text);
      described.put("truncated", truncated);
      described.put("size", (double) size);
      return described;
    } catch (IOException | RuntimeException error) {
      described.clear();
      described.put("kind", "stream");
      return described;
    }
  }

  static boolean isTextual(@Nullable MediaType type, @Nullable String rawContentType) {
    String value = type != null ? type.toString() : rawContentType;
    if (value == null || value.isEmpty()) {
      // No content type: assume text, the capture is capped anyway and the
      // UI falls back to showing raw bytes as text.
      return true;
    }
    String lower = value.toLowerCase(Locale.US);
    return lower.startsWith("text/")
        || lower.contains("json")
        || lower.contains("xml")
        || lower.contains("javascript")
        || lower.contains("x-www-form-urlencoded")
        || lower.contains("graphql")
        || lower.contains("html")
        || lower.contains("csv")
        || lower.contains("yaml");
  }

  static Map<String, Object> failedEvent(String requestId, Throwable error) {
    Map<String, Object> failed = new HashMap<>();
    failed.put("type", "failed");
    failed.put("requestId", requestId);
    failed.put("timestamp", (double) System.currentTimeMillis());
    String message = error.getMessage();
    failed.put("error", message == null || message.isEmpty() ? error.getClass().getSimpleName() : message);
    failed.put("canceled", error instanceof IOException && "Canceled".equalsIgnoreCase(message));
    return failed;
  }

  static Map<String, Object> completedEvent(String requestId, long size, @Nullable Map<String, Object> body) {
    Map<String, Object> completed = new HashMap<>();
    completed.put("type", "completed");
    completed.put("requestId", requestId);
    completed.put("timestamp", (double) System.currentTimeMillis());
    completed.put("size", (double) size);
    completed.put("body", body);
    return completed;
  }

  /**
   * Copies the bytes the app reads into a capped buffer and reports the
   * request as completed when the stream is exhausted or closed.
   */
  private static final class TeeSource extends ForwardingSource {
    private final String requestId;
    private final NativeNetworkRecorder recorder;
    private final boolean textual;
    private final Charset charset;
    private final Buffer captured = new Buffer();
    private final int maxBytes;
    private long totalBytes = 0;
    private boolean reported = false;

    TeeSource(Source delegate, String requestId, NativeNetworkRecorder recorder, boolean textual, Charset charset) {
      super(delegate);
      this.requestId = requestId;
      this.recorder = recorder;
      this.textual = textual;
      this.charset = charset;
      this.maxBytes = recorder.getMaxBodyBytes();
    }

    @Override
    public long read(@NonNull Buffer sink, long byteCount) throws IOException {
      long bytesRead;
      try {
        bytesRead = super.read(sink, byteCount);
      } catch (IOException error) {
        report(failedEvent(requestId, error));
        throw error;
      }
      if (bytesRead == -1) {
        complete();
        return -1;
      }
      totalBytes += bytesRead;
      long room = maxBytes - captured.size();
      if (room > 0) {
        sink.copyTo(captured, sink.size() - bytesRead, Math.min(bytesRead, room));
      }
      return bytesRead;
    }

    @Override
    public void close() throws IOException {
      complete();
      super.close();
    }

    private void complete() {
      Map<String, Object> body = null;
      if (totalBytes > 0) {
        body = new HashMap<>();
        boolean truncated = totalBytes > captured.size();
        if (textual) {
          body.put("kind", "text");
          body.put("value", captured.clone().readString(charset));
        } else if (totalBytes <= maxBytes) {
          body.put("kind", "base64");
          body.put("value", Base64.encodeToString(captured.clone().readByteArray(), Base64.NO_WRAP));
        } else {
          body.put("kind", "too-large");
          body.put("size", (double) totalBytes);
          report(completedEvent(requestId, totalBytes, body));
          return;
        }
        body.put("truncated", truncated);
        body.put("size", (double) totalBytes);
      }
      report(completedEvent(requestId, totalBytes, body));
    }

    private synchronized void report(Map<String, Object> event) {
      if (reported) {
        return;
      }
      reported = true;
      recorder.emit(event);
    }
  }
}
