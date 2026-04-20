import type { GenerateDraftInput, GeneratedDraft } from './types.js';
import { generatePlatformDraft } from './shared.js';

export async function generateWeiboDraft(input: GenerateDraftInput): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'weibo',
    input,
    'Write a short Chinese Weibo post with a punchy, conversational tone.',
  );
}
