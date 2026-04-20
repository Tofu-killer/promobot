import { chat } from '../aiClient.js';
import type { GeneratedDraft, GenerateDraftInput } from './types.js';

export async function generatePlatformDraft(
  platform: string,
  input: GenerateDraftInput,
  instructions: string,
): Promise<GeneratedDraft> {
  const tone = input.tone ?? 'professional';
  const siteName = input.siteContext?.siteName ?? 'PromoBot';
  const siteUrl = input.siteContext?.siteUrl ?? 'https://example.com';
  const content = await chat(
    `You generate ${platform} promotional drafts for ${siteName}. ${instructions}`,
    [
      `Platform: ${platform}`,
      `Tone: ${tone}`,
      `Topic: ${input.topic}`,
      `Site URL: ${siteUrl}`,
    ].join('\n'),
  );

  return {
    platform,
    content,
    hashtags: [],
  };
}
