#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * React Native module behind `rozenite-native-network-plugin`.
 *
 * In DEBUG builds the NSURLProtocol hook is installed automatically when the
 * class loads, before any request can be made. Call `+install` yourself from
 * `application:didFinishLaunchingWithOptions:` only if you build a custom
 * configuration where DEBUG is not defined for pods.
 */
@interface RozeniteNativeNetwork : RCTEventEmitter <RCTBridgeModule>

+ (void)install;

@end

NS_ASSUME_NONNULL_END
