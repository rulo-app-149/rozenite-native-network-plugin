#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^RNNRecorderListener)(NSDictionary<NSString *, id> *event);

/**
 * Process-wide sink for the events RNNURLProtocol produces.
 *
 * Events are kept in a ring buffer until a listener (the React module)
 * attaches, so traffic that happens before the JS side is ready (boot-time
 * SDK calls, splash-screen images) is not lost.
 */
@interface RNNRecorder : NSObject

@property (class, readonly) RNNRecorder *sharedRecorder;

/** Whether RNNURLProtocol should claim requests at all. Defaults to YES. */
@property (atomic, assign, getter=isCapturing) BOOL capturing;

/** Cap on captured body bytes per request / response. Defaults to 256 KiB. */
@property (atomic, assign) NSUInteger maxBodyBytes;

/** Attaching a listener flushes the buffered events to it, in order. */
- (void)setListener:(nullable RNNRecorderListener)listener;

- (void)emit:(NSDictionary<NSString *, id> *)event;

- (void)clearBuffer;

@end

NS_ASSUME_NONNULL_END
