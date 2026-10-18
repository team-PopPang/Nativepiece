#import "NPEventRouter.h"

NS_ASSUME_NONNULL_BEGIN

typedef void (^NPMessageSink)(NSString *_Nullable surfaceId, NSString *name, NSString *_Nullable payloadJson);

@interface NPEventRouter (Internal)

+ (void)dispatchEventFromSurface:(NSString *)surfaceId name:(NSString *)name payloadJson:(nullable NSString *)payloadJson;

// TurboModule이 만들어지면 메시지를 JS로 내보낼 sink를 등록한다. 그 전에 보낸 메시지는 큐에 쌓아 둔다.
+ (void)setMessageSink:(NPMessageSink)sink;

// 지금 등록된 sink가 이 sink일 때만 해제한다. 새로 만들어진 모듈의 sink를 지우지 않기 위해서다.
+ (void)clearMessageSink:(NPMessageSink)sink;

@end

NS_ASSUME_NONNULL_END
