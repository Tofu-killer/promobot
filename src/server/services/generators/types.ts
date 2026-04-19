export type DraftTone = 'professional' | 'casual' | 'exciting';

export interface SiteContext {
  siteName?: string;
  siteUrl?: string;
  siteDescription?: string;
  sellingPoints?: string[];
}

export interface GenerateDraftInput {
  topic: string;
  tone?: DraftTone;
  siteContext?: SiteContext;
}

export interface GeneratedDraft {
  platform: string;
  title?: string;
  content: string;
  hashtags: string[];
  estimatedReadTime?: number;
}
