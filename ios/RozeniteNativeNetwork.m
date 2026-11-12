#import "RozeniteNativeNetwork.h"
#import "RNNRecorder.h"
#import "RNNURLProtocol.h"

static NSString *const RNNEventName = @"RozeniteNativeNetwork";

@implementation RozeniteNativeNetwork {
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE(RozeniteNativeNetwork)

+ (void)load
{
#if DEBUG
  [self install];
#endif
}

+ (void)install
{
  [RNNURLProtocol install];
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ RNNEventName ];
}

- (void)startObserving
{
  _hasListeners = YES;
}

- (void)stopObserving
{
  _hasListeners = NO;
}

- (void)invalidate
{
  [[RNNRecorder sharedRecorder] setListener:nil];
  [super invalidate];
}

RCT_EXPORT_METHOD(setEnabled : (BOOL)enabled)
{
  RNNRecorder *recorder = [RNNRecorder sharedRecorder];
  recorder.capturing = enabled;

  if (!enabled) {
    [recorder setListener:nil];
    return;
  }

  __weak RozeniteNativeNetwork *weakSelf = self;
  // Attaching flushes whatever was buffered before JS was ready.
  [recorder setListener:^(NSDictionary<NSString *, id> *event) {
    RozeniteNativeNetwork *strongSelf = weakSelf;
    if (strongSelf && strongSelf->_hasListeners) {
      [strongSelf sendEventWithName:RNNEventName body:event];
    }
  }];
}

RCT_EXPORT_METHOD(setMaxBodyBytes : (double)bytes)
{
  [RNNRecorder sharedRecorder].maxBodyBytes = bytes > 0 ? (NSUInteger)bytes : 0;
}

RCT_EXPORT_METHOD(clearBuffer)
{
  [[RNNRecorder sharedRecorder] clearBuffer];
}

// `addListener:` / `removeListeners:`, which NativeEventEmitter calls, are
// exported by RCTEventEmitter itself.

@end
