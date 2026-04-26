export type PublisherPlatform =
  | 'x'
  | 'reddit'
  | 'facebookGroup'
  | 'instagram'
  | 'tiktok'
  | 'xiaohongshu'
  | 'weibo'
  | 'blog';

export type PublishMode = 'api' | 'browser' | 'manual';
export type PublishStatus = 'published' | 'queued' | 'manual_required' | 'failed';

export interface PublishRequest {
  draftId: number | string;
  content: string;
  title?: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  platform: PublisherPlatform;
  mode: PublishMode;
  status: PublishStatus;
  success: boolean;
  publishUrl: string | null;
  externalId: string | null;
  message: string;
  publishedAt: string | null;
  details?: Record<string, unknown>;
}

export type Publisher = (request: PublishRequest) => Promise<PublishResult>;
