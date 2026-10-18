#import "NPNativepieceHost.h"
#import "NPChannel+Internal.h"

@implementation NPNativepieceHost {
  NPEnvelopeHandler _sink;
}

RCT_EXPORT_MODULE(NativepieceHost)

- (instancetype)init
{
  if (self = [super init]) {
    __weak NPNativepieceHost *weakSelf = self;
    _sink = [^(NSString *envelopeJson) {
      [weakSelf emitOnEnvelope:envelopeJson];
    } copy];
  }
  return self;
}

// JS 이벤트 콜백이 연결되기 전에 emit하면 빈 콜백을 호출하게 되므로, 연결된 뒤에 sink를 등록한다.
- (void)setEventEmitterCallback:(EventEmitterCallbackWrapper *)eventEmitterCallbackWrapper
{
  [super setEventEmitterCallback:eventEmitterCallbackWrapper];
  [NPChannel setJSSink:_sink];
}

- (void)invalidate
{
  [NPChannel clearJSSink:_sink];
}

- (void)post:(NSString *)envelopeJson
{
  [NPChannel receiveFromJS:envelopeJson];
}

- (NSNumber *)protocolVersion
{
  return @(NPProtocolVersion);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeNativepieceHostSpecJSI>(params);
}

@end
