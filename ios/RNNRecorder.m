#import "RNNRecorder.h"

static const NSUInteger RNNMaxBufferedEvents = 500;

@implementation RNNRecorder {
  NSMutableArray<NSDictionary<NSString *, id> *> *_buffer;
  RNNRecorderListener _listener;
  NSLock *_lock;
}

+ (RNNRecorder *)sharedRecorder
{
  static RNNRecorder *instance;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    instance = [RNNRecorder new];
  });
  return instance;
}

- (instancetype)init
{
  if (self = [super init]) {
    _buffer = [NSMutableArray new];
    _lock = [NSLock new];
    _capturing = YES;
    _maxBodyBytes = 256 * 1024;
  }
  return self;
}

- (void)setListener:(RNNRecorderListener)listener
{
  NSArray *pending = nil;
  [_lock lock];
  _listener = [listener copy];
  if (listener) {
    pending = [_buffer copy];
    [_buffer removeAllObjects];
  }
  [_lock unlock];

  for (NSDictionary *event in pending) {
    listener(event);
  }
}

- (void)emit:(NSDictionary<NSString *, id> *)event
{
  if (!self.isCapturing) {
    return;
  }

  RNNRecorderListener listener;
  [_lock lock];
  listener = _listener;
  if (!listener) {
    if (_buffer.count >= RNNMaxBufferedEvents) {
      [_buffer removeObjectAtIndex:0];
    }
    [_buffer addObject:event];
  }
  [_lock unlock];

  if (listener) {
    listener(event);
  }
}

- (void)clearBuffer
{
  [_lock lock];
  [_buffer removeAllObjects];
  [_lock unlock];
}

@end
