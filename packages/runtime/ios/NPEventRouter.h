#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^NPEventHandler)(NSString *name, NSString *_Nullable payloadJson);

// RN 화면과 네이티브 호스트 사이의 메시지를 surfaceId 단위로 연결한다.
// Swift 호스트 SDK가 사용하므로 C++ 헤더를 포함하지 않는다.
@interface NPEventRouter : NSObject

// surfaceId 화면이 보낸 이벤트를 받을 handler를 등록한다. nil이면 등록을 해제한다.
+ (void)setHandler:(nullable NPEventHandler)handler forSurface:(NSString *)surfaceId;

// 앱이 RN으로 메시지를 보낸다. surfaceId가 nil이면 모든 화면에 보낸다.
+ (void)sendMessage:(NSString *)name payloadJson:(nullable NSString *)payloadJson toSurface:(nullable NSString *)surfaceId;

@end

NS_ASSUME_NONNULL_END
