#import "NPEventRouter+Internal.h"

@interface NPPendingMessage : NSObject
@property (nonatomic, copy, nullable) NSString *surfaceId;
@property (nonatomic, copy) NSString *name;
@property (nonatomic, copy, nullable) NSString *payloadJson;
@end

@implementation NPPendingMessage
@end

static NSMutableDictionary<NSString *, NPEventHandler> *handlers;
static NSMutableArray<NPPendingMessage *> *pendingMessages;
static NPMessageSink messageSink;

@implementation NPEventRouter

+ (void)initialize
{
  if (self == [NPEventRouter class]) {
    handlers = [NSMutableDictionary new];
    pendingMessages = [NSMutableArray new];
  }
}

+ (void)setHandler:(NPEventHandler)handler forSurface:(NSString *)surfaceId
{
  @synchronized(self) {
    handlers[surfaceId] = [handler copy];
  }
}

+ (void)sendMessage:(NSString *)name payloadJson:(NSString *)payloadJson toSurface:(NSString *)surfaceId
{
  NPMessageSink sink;
  @synchronized(self) {
    sink = messageSink;
    if (sink == nil) {
      NPPendingMessage *message = [NPPendingMessage new];
      message.surfaceId = surfaceId;
      message.name = name;
      message.payloadJson = payloadJson;
      [pendingMessages addObject:message];
      return;
    }
  }
  sink(surfaceId, name, payloadJson);
}

+ (void)dispatchEventFromSurface:(NSString *)surfaceId name:(NSString *)name payloadJson:(NSString *)payloadJson
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NPEventHandler handler;
    @synchronized(NPEventRouter.class) {
      handler = handlers[surfaceId];
    }
    if (handler != nil) {
      handler(name, payloadJson);
    }
  });
}

+ (void)setMessageSink:(NPMessageSink)sink
{
  NSArray<NPPendingMessage *> *flushed;
  @synchronized(self) {
    messageSink = sink;
    flushed = [pendingMessages copy];
    [pendingMessages removeAllObjects];
  }
  for (NPPendingMessage *message in flushed) {
    sink(message.surfaceId, message.name, message.payloadJson);
  }
}

+ (void)clearMessageSink:(NPMessageSink)sink
{
  @synchronized(self) {
    if (messageSink == sink) {
      messageSink = nil;
    }
  }
}

@end
