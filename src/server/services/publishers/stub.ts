import type {
  PublishMode,
  PublishRequest,
  PublishResult,
  PublishStatus,
  Publisher,
  PublisherPlatform,
} from './types';

interface StubPublisherConfig {
  platform: PublisherPlatform;
  mode: PublishMode;
  status?: PublishStatus;
  buildPublishUrl?: (draftId: string, request: PublishRequest) => string;
}

export function createStubPublisher(config: StubPublisherConfig): Publisher {
  return async (request: PublishRequest): Promise<PublishResult> => {
    const draftId = String(request.draftId);
    const status = config.status ?? 'published';
    const success = status === 'published';

    return {
      platform: config.platform,
      mode: config.mode,
      status,
      success,
      publishUrl: success ? buildPublishUrl(config, draftId, request) : null,
      externalId: success ? `${config.platform}-${draftId}` : null,
      message: `${config.platform} stub publisher accepted draft ${draftId}`,
      publishedAt: success ? new Date().toISOString() : null,
      details: request.target ? { target: request.target } : undefined,
    };
  };
}

function buildPublishUrl(
  config: StubPublisherConfig,
  draftId: string,
  request: PublishRequest,
): string {
  if (config.buildPublishUrl) {
    return config.buildPublishUrl(draftId, request);
  }

  switch (config.platform) {
    case 'x':
      return `https://x.com/promobot/status/${draftId}`;
    case 'reddit':
      return `https://reddit.com/r/promobot/comments/${draftId}`;
    case 'facebookGroup':
      return `https://www.facebook.com/groups/promobot/posts/${draftId}`;
    case 'xiaohongshu':
      return `https://www.xiaohongshu.com/explore/${draftId}`;
    case 'weibo':
      return `https://weibo.com/promobot/${draftId}`;
    case 'blog':
      return `https://blog.promobot.local/posts/${draftId}`;
  }
}
