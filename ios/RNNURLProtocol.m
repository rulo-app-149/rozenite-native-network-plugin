#import "RNNURLProtocol.h"
#import "RNNRecorder.h"

#import <objc/message.h>
#import <objc/runtime.h>

static NSString *const RNNHandledKey = @"RozeniteNativeNetworkHandled";

/** Request bodies above this are left as streams and not captured. */
static const NSUInteger RNNMaxBufferedRequestBody = 10 * 1024 * 1024;

static BOOL RNNInstalled = NO;

static double RNNNow(void)
{
  return [[NSDate date] timeIntervalSince1970] * 1000.0;
}

static NSDictionary<NSString *, NSString *> *RNNHeadersToMap(NSDictionary *headers)
{
  NSMutableDictionary *map = [NSMutableDictionary new];
  [headers enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
    map[[[key description] lowercaseString]] = [value description];
  }];
  return map;
}

static BOOL RNNIsTextual(NSString *contentType)
{
  if (contentType.length == 0) {
    // No content type: assume text, the capture is capped anyway.
    return YES;
  }
  NSString *lower = contentType.lowercaseString;
  return [lower hasPrefix:@"text/"] || [lower containsString:@"json"] || [lower containsString:@"xml"] ||
         [lower containsString:@"javascript"] || [lower containsString:@"x-www-form-urlencoded"] ||
         [lower containsString:@"graphql"] || [lower containsString:@"html"] || [lower containsString:@"csv"] ||
         [lower containsString:@"yaml"];
}

static NSString *RNNDecodeText(NSData *data, NSString *contentType)
{
  NSStringEncoding encoding = NSUTF8StringEncoding;
  NSRange charsetRange = [contentType.lowercaseString rangeOfString:@"charset="];
  if (charsetRange.location != NSNotFound) {
    NSString *charset = [contentType substringFromIndex:NSMaxRange(charsetRange)];
    charset = [[charset componentsSeparatedByString:@";"] firstObject];
    charset = [charset stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    CFStringEncoding cfEncoding = CFStringConvertIANACharSetNameToEncoding((__bridge CFStringRef)charset);
    if (cfEncoding != kCFStringEncodingInvalidId) {
      encoding = CFStringConvertEncodingToNSStringEncoding(cfEncoding);
    }
  }
  NSString *text = [[NSString alloc] initWithData:data encoding:encoding];
  if (!text) {
    text = [[NSString alloc] initWithData:data encoding:NSISOLatin1StringEncoding];
  }
  return text ?: @"";
}

@interface RNNURLProtocol () <NSURLSessionDataDelegate>
@end

@implementation RNNURLProtocol {
  NSURLSession *_session;
  NSURLSessionDataTask *_task;
  NSString *_requestId;
  NSMutableData *_captured;
  NSUInteger _totalBytes;
  NSUInteger _maxBodyBytes;
  NSString *_contentType;
  NSString *_protocolName;
  BOOL _fromCache;
  BOOL _stopped;
}

#pragma mark - Installation

+ (void)install
{
  if (RNNInstalled) {
    return;
  }
  RNNInstalled = YES;

  // Covers NSURLConnection and the shared NSURLSession.
  [NSURLProtocol registerClass:[RNNURLProtocol class]];

  // Covers every NSURLSession built from a default / ephemeral configuration
  // from now on (RCTNetworking creates its session lazily, after this runs).
  [RNNURLProtocol swizzleSessionConfiguration];
}

+ (BOOL)isInstalled
{
  return RNNInstalled;
}

+ (void)swizzleSessionConfiguration
{
  // The concrete configuration class (__NSCFURLSessionConfiguration) is what
  // implements -protocolClasses, so that is where the swap has to happen.
  Class cls = [[NSURLSessionConfiguration defaultSessionConfiguration] class];
  SEL originalSelector = @selector(protocolClasses);
  SEL swizzledSelector = @selector(rnn_protocolClasses);

  Method original = class_getInstanceMethod(cls, originalSelector);
  Method replacement = class_getInstanceMethod([RNNURLProtocol class], @selector(rnn_protocolClassesTemplate));
  if (!original || !replacement) {
    return;
  }

  BOOL added = class_addMethod(cls, swizzledSelector, method_getImplementation(replacement),
                               method_getTypeEncoding(replacement));
  if (!added) {
    return;
  }
  Method swizzled = class_getInstanceMethod(cls, swizzledSelector);
  method_exchangeImplementations(original, swizzled);
}

// Template whose implementation is copied onto the configuration class.
// `self` is an NSURLSessionConfiguration at runtime.
- (NSArray *)rnn_protocolClassesTemplate
{
  // After the exchange, `rnn_protocolClasses` on the configuration class is
  // the original implementation.
  NSArray *original = ((NSArray * (*)(id, SEL))objc_msgSend)(self, @selector(rnn_protocolClasses));
  if (![RNNRecorder sharedRecorder].isCapturing) {
    return original;
  }
  if ([original containsObject:[RNNURLProtocol class]]) {
    return original;
  }
  return [@[ [RNNURLProtocol class] ] arrayByAddingObjectsFromArray:original ?: @[]];
}

#pragma mark - NSURLProtocol

+ (BOOL)canInitWithRequest:(NSURLRequest *)request
{
  if (![RNNRecorder sharedRecorder].isCapturing) {
    return NO;
  }
  if ([NSURLProtocol propertyForKey:RNNHandledKey inRequest:request]) {
    return NO;
  }
  NSString *scheme = request.URL.scheme.lowercaseString;
  return [scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"];
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request
{
  return request;
}

- (void)startLoading
{
  RNNRecorder *recorder = [RNNRecorder sharedRecorder];
  _maxBodyBytes = recorder.maxBodyBytes;
  _captured = [NSMutableData new];
  _requestId = [[NSUUID UUID] UUIDString];

  NSMutableURLRequest *request = [self.request mutableCopy];
  [NSURLProtocol setProperty:@YES forKey:RNNHandledKey inRequest:request];

  // NSURLSession hands protocols the body as a stream; read it back into
  // HTTPBody so it can be captured and so the replayed task can retry it.
  id body = [self captureRequestBody:request];

  [recorder emit:@{
    @"type" : @"started",
    @"requestId" : _requestId,
    @"url" : request.URL.absoluteString ?: @"",
    @"method" : request.HTTPMethod ?: @"GET",
    @"headers" : RNNHeadersToMap(request.allHTTPHeaderFields ?: @{}),
    @"body" : body ?: [NSNull null],
    @"timestamp" : @(RNNNow()),
    @"platform" : @"ios",
    @"transport" : @"nsurlsession",
    @"client" : @"url-protocol",
  }];

  NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration defaultSessionConfiguration];
  _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
  _task = [_session dataTaskWithRequest:request];
  [_task resume];
}

- (void)stopLoading
{
  _stopped = YES;
  [_task cancel];
  [_session finishTasksAndInvalidate];
}

- (id)captureRequestBody:(NSMutableURLRequest *)request
{
  NSData *data = request.HTTPBody;
  NSString *contentType = [request valueForHTTPHeaderField:@"Content-Type"] ?: @"";

  if (!data && request.HTTPBodyStream) {
    NSString *lengthHeader = [request valueForHTTPHeaderField:@"Content-Length"];
    NSUInteger declared = lengthHeader ? (NSUInteger)[lengthHeader longLongValue] : 0;
    if (declared > RNNMaxBufferedRequestBody) {
      return @{ @"kind" : @"stream" };
    }

    NSInputStream *stream = request.HTTPBodyStream;
    NSMutableData *buffer = [NSMutableData new];
    uint8_t chunk[16 * 1024];
    [stream open];
    while (stream.hasBytesAvailable) {
      NSInteger read = [stream read:chunk maxLength:sizeof(chunk)];
      if (read <= 0) {
        break;
      }
      [buffer appendBytes:chunk length:(NSUInteger)read];
      if (buffer.length > RNNMaxBufferedRequestBody) {
        break;
      }
    }
    [stream close];

    data = buffer;
    request.HTTPBody = data;
    request.HTTPBodyStream = nil;
  }

  if (!data || data.length == 0) {
    return nil;
  }

  if (!RNNIsTextual(contentType)) {
    return @{ @"kind" : @"binary", @"size" : @(data.length), @"contentType" : contentType };
  }

  BOOL truncated = data.length > _maxBodyBytes;
  NSData *slice = truncated ? [data subdataWithRange:NSMakeRange(0, _maxBodyBytes)] : data;
  return @{
    @"kind" : @"text",
    @"value" : RNNDecodeText(slice, contentType),
    @"truncated" : @(truncated),
    @"size" : @(data.length),
  };
}

#pragma mark - NSURLSessionDataDelegate

- (void)URLSession:(NSURLSession *)session
              dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveResponse:(NSURLResponse *)response
     completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler
{
  NSHTTPURLResponse *http = [response isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse *)response : nil;
  _contentType = http.allHeaderFields[@"Content-Type"] ?: response.MIMEType ?: @"";

  [[RNNRecorder sharedRecorder] emit:@{
    @"type" : @"response",
    @"requestId" : _requestId,
    @"status" : @(http ? http.statusCode : 0),
    @"statusText" : http ? [NSHTTPURLResponse localizedStringForStatusCode:http.statusCode] : @"",
    @"headers" : RNNHeadersToMap(http.allHeaderFields ?: @{}),
    @"mimeType" : _contentType,
    @"timestamp" : @(RNNNow()),
    @"url" : response.URL.absoluteString ?: @"",
  }];

  if (!_stopped) {
    // The inner session already honours the cache policy; do not let the
    // outer one store a second copy.
    [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
  }
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data
{
  _totalBytes += data.length;
  if (_captured.length < _maxBodyBytes) {
    NSUInteger room = _maxBodyBytes - _captured.length;
    [_captured appendData:data.length > room ? [data subdataWithRange:NSMakeRange(0, room)] : data];
  }
  if (!_stopped) {
    [self.client URLProtocol:self didLoadData:data];
  }
}

- (void)URLSession:(NSURLSession *)session
                          task:(NSURLSessionTask *)task
    willPerformHTTPRedirection:(NSHTTPURLResponse *)response
                    newRequest:(NSURLRequest *)request
             completionHandler:(void (^)(NSURLRequest *_Nullable))completionHandler
{
  // Follow redirects transparently; the final URL is reported with the
  // response event.
  NSMutableURLRequest *next = [request mutableCopy];
  [NSURLProtocol setProperty:@YES forKey:RNNHandledKey inRequest:next];
  completionHandler(next);
}

- (void)URLSession:(NSURLSession *)session
                  task:(NSURLSessionTask *)task
    didFinishCollectingMetrics:(NSURLSessionTaskMetrics *)metrics
{
  NSURLSessionTaskTransactionMetrics *last = metrics.transactionMetrics.lastObject;
  _protocolName = last.networkProtocolName;
  _fromCache = last.resourceFetchType == NSURLSessionTaskMetricsResourceFetchTypeLocalCache;
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error
{
  RNNRecorder *recorder = [RNNRecorder sharedRecorder];

  if (error) {
    [recorder emit:@{
      @"type" : @"failed",
      @"requestId" : _requestId,
      @"timestamp" : @(RNNNow()),
      @"error" : error.localizedDescription ?: @"Unknown error",
      @"canceled" : @(error.code == NSURLErrorCancelled),
    }];
    if (!_stopped) {
      [self.client URLProtocol:self didFailWithError:error];
    }
  } else {
    [recorder emit:@{
      @"type" : @"completed",
      @"requestId" : _requestId,
      @"timestamp" : @(RNNNow()),
      @"size" : @(_totalBytes),
      @"body" : [self describeResponseBody],
      @"protocol" : _protocolName ?: [NSNull null],
      @"fromCache" : @(_fromCache),
    }];
    if (!_stopped) {
      [self.client URLProtocolDidFinishLoading:self];
    }
  }

  [session finishTasksAndInvalidate];
}

- (id)describeResponseBody
{
  if (_totalBytes == 0) {
    return [NSNull null];
  }
  BOOL truncated = _totalBytes > _captured.length;
  if (RNNIsTextual(_contentType)) {
    return @{
      @"kind" : @"text",
      @"value" : RNNDecodeText(_captured, _contentType),
      @"truncated" : @(truncated),
      @"size" : @(_totalBytes),
    };
  }
  if (_totalBytes <= _maxBodyBytes) {
    return @{
      @"kind" : @"base64",
      @"value" : [_captured base64EncodedStringWithOptions:0],
      @"truncated" : @NO,
      @"size" : @(_totalBytes),
    };
  }
  return @{ @"kind" : @"too-large", @"size" : @(_totalBytes) };
}

@end
