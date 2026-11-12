#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * NSURLProtocol that records every HTTP(S) request going through
 * NSURLSession / NSURLConnection and replays it on its own session.
 *
 * Installed by `+[RNNURLProtocol install]`: registered globally with
 * NSURLProtocol and prepended to `protocolClasses` of every
 * NSURLSessionConfiguration created afterwards (default and ephemeral), so
 * React Native's RCTNetworking, SDWebImage / Kingfisher style image loaders
 * and third-party native SDKs are all covered. Sessions whose configuration
 * sets `protocolClasses` explicitly after creation are not.
 */
@interface RNNURLProtocol : NSURLProtocol

+ (void)install;
+ (BOOL)isInstalled;

@end

NS_ASSUME_NONNULL_END
