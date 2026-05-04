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
  const promptLines = [
    `Platform: ${platform}`,
    `Tone: ${tone}`,
    `Topic: ${input.topic}`,
    `Site URL: ${siteUrl}`,
  ];

  if (input.siteContext?.siteDescription) {
    promptLines.push(`Site Description: ${input.siteContext.siteDescription}`);
  }

  if (input.siteContext?.sellingPoints && input.siteContext.sellingPoints.length > 0) {
    promptLines.push(`Selling Points: ${input.siteContext.sellingPoints.join(', ')}`);
  }

  if (input.siteContext?.brandVoice) {
    promptLines.push(`Brand Voice: ${input.siteContext.brandVoice}`);
  }

  if (input.siteContext?.ctas && input.siteContext.ctas.length > 0) {
    promptLines.push(`CTAs: ${input.siteContext.ctas.join(', ')}`);
  }

  if (input.siteContext?.bannedPhrases && input.siteContext.bannedPhrases.length > 0) {
    promptLines.push(`Banned Phrases: ${input.siteContext.bannedPhrases.join(', ')}`);
  }

  if (input.siteContext?.defaultLanguagePolicy) {
    promptLines.push(`Default Language Policy: ${input.siteContext.defaultLanguagePolicy}`);
  }

  const content = await chat(
    `You generate ${platform} promotional drafts for ${siteName}. ${instructions} Use the provided site context, selling points, brand voice, CTAs, banned phrases, and language policy when drafting.`,
    promptLines.join('\n'),
  );

  return {
    platform,
    content,
    hashtags: [],
  };
}
