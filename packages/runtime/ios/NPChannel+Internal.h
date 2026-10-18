#import "NPChannel.h"

NS_ASSUME_NONNULL_BEGIN

@interface NPChannel (Internal)

+ (void)receiveFromJS:(NSString *)envelopeJson;

+ (void)setJSSink:(NPEnvelopeHandler)sink;

// 지금 등록된 sink가 이 sink일 때만 해제한다. 새로 만들어진 모듈의 sink를 지우지 않기 위해서다.
+ (void)clearJSSink:(NPEnvelopeHandler)sink;

@end

NS_ASSUME_NONNULL_END
