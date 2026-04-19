import type { GenerateDraftInput, GeneratedDraft } from './types';
import { generatePlatformDraft } from './shared';

export async function generateXiaohongshuDraft(
  input: GenerateDraftInput,
): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'xiaohongshu',
    input,
    'Write a Chinese lifestyle-style post with segmented copy and light emoji use.',
  );
}
