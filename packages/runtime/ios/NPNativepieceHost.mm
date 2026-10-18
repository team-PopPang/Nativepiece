#import "NPNativepieceHost.h"
#import "NPEventRouter+Internal.h"

@implementation NPNativepieceHost {
  NPMessageSink _sink;
}

RCT_EXPORT_MODULE(NativepieceHost)

- (instancetype)init
{
  if (self = [super init]) {
    __weak NPNativepieceHost *weakSelf = self;
    _sink = [^(NSString *surfaceId, NSString *name, NSString *payloadJson) {
      [weakSelf emitOnHostMessage:@{
        @"surfaceId" : surfaceId ?: (id)[NSNull null],
        @"name" : name,
        @"payloadJson" : payloadJson ?: (id)[NSNull null],
      }];
    } copy];
  }
  return self;
}

// JS 이벤트 콜백이 연결되기 전에 emit하면 빈 콜백을 호출하게 되므로, 연결된 뒤에 sink를 등록한다.
- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  [super setEventEmitterCallback:eventEmitterCallbackWrapper];
  [NPEventRouter setMessageSink:_sink];
}

- (void)invalidate
{
  [NPEventRouter clearMessageSink:_sink];
}

- (void)emit:(NSString *)surfaceId name:(NSString *)name payloadJson:(NSString *)payloadJson
{
  [NPEventRouter dispatchEventFromSurface:surfaceId name:name payloadJson:payloadJson];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeNativepieceHostSpecJSI>(params);
}

@end
