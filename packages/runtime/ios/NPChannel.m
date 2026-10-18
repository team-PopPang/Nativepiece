#import "NPChannel+Internal.h"

const NSInteger NPProtocolVersion = 1;

// 한쪽이 아직 준비되지 않았을 때 쌓아 두는 envelope 수의 상한이다.
static const NSUInteger NPMaxPendingEnvelopes = 200;

static NPEnvelopeHandler hostHandler;
static NPEnvelopeHandler jsSink;
static NSMutableArray<NSString *> *pendingToHost;
static NSMutableArray<NSString *> *pendingToJS;

static void NPEnqueue(NSMutableArray<NSString *> *queue, NSString *envelopeJson)
{
  [queue addObject:envelopeJson];
  if (queue.count > NPMaxPendingEnvelopes) {
    [queue removeObjectAtIndex:0];
  }
}

@implementation NPChannel

+ (void)initialize
{
  if (self == [NPChannel class]) {
    pendingToHost = [NSMutableArray new];
    pendingToJS = [NSMutableArray new];
  }
}

+ (void)setHostHandler:(NPEnvelopeHandler)handler
{
  NSArray<NSString *> *flushed;
  @synchronized(self) {
    hostHandler = [handler copy];
    if (handler == nil) {
      return;
    }
    flushed = [pendingToHost copy];
    [pendingToHost removeAllObjects];
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    for (NSString *envelope in flushed) {
      handler(envelope);
    }
  });
}

+ (void)postToJS:(NSString *)envelopeJson
{
  NPEnvelopeHandler sink;
  @synchronized(self) {
    sink = jsSink;
    if (sink == nil) {
      NPEnqueue(pendingToJS, envelopeJson);
      return;
    }
  }
  sink(envelopeJson);
}

+ (void)receiveFromJS:(NSString *)envelopeJson
{
  NPEnvelopeHandler handler;
  @synchronized(self) {
    handler = hostHandler;
    if (handler == nil) {
      NPEnqueue(pendingToHost, envelopeJson);
      return;
    }
  }
  // 호스트 handler는 UI를 다루므로 메인 스레드에서 실행한다.
  dispatch_async(dispatch_get_main_queue(), ^{
    handler(envelopeJson);
  });
}

+ (void)setJSSink:(NPEnvelopeHandler)sink
{
  NSArray<NSString *> *flushed;
  @synchronized(self) {
    jsSink = sink;
    flushed = [pendingToJS copy];
    [pendingToJS removeAllObjects];
  }
  for (NSString *envelope in flushed) {
    sink(envelope);
  }
}

+ (void)clearJSSink:(NPEnvelopeHandler)sink
{
  @synchronized(self) {
    if (jsSink == sink) {
      jsSink = nil;
    }
  }
}

@end
