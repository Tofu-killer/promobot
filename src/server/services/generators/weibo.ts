import type { GenerateDraftInput, GeneratedDraft } from './types';
import { generatePlatformDraft } from './shared';

export async function generateWeiboDraft(input: GenerateDraftInput): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'weibo',
    input,
    'Write a short Chinese Weibo post with a punchy, conversational tone.',
  );
}
