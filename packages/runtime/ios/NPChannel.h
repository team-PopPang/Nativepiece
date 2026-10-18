#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// 호스트 SDK와 RN이 주고받는 프로토콜 버전이다. JS의 PROTOCOL_VERSION과 같아야 한다.
FOUNDATION_EXPORT const NSInteger NPProtocolVersion;

typedef void (^NPEnvelopeHandler)(NSString *envelopeJson);

// RN과 네이티브 호스트 사이에서 envelope(JSON 문자열)을 그대로 전달한다.
// 라우팅과 해석은 Swift 호스트 SDK가 맡으므로, 이 클래스는 C++ 없이 문자열만 다룬다.
@interface NPChannel : NSObject

// RN이 보낸 envelope을 받을 handler를 등록한다. 등록 전에 온 envelope은 등록할 때 전달한다.
+ (void)setHostHandler:(nullable NPEnvelopeHandler)handler;

// RN으로 envelope을 보낸다. JS 쪽이 준비되기 전에 보낸 envelope은 쌓아 뒀다가 전달한다.
+ (void)postToJS:(NSString *)envelopeJson;

@end

NS_ASSUME_NONNULL_END
