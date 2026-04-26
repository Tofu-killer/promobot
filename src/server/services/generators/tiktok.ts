import type { GenerateDraftInput, GeneratedDraft } from './types.js';
import { generatePlatformDraft } from './shared.js';

export async function generateTiktokDraft(input: GenerateDraftInput): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'tiktok',
    input,
    'Write a punchy TikTok caption or short script with a fast hook, simple beats, and a clear CTA.',
  );
}
