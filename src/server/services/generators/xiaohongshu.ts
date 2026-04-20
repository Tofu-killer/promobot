import type { GenerateDraftInput, GeneratedDraft } from './types.js';
import { generatePlatformDraft } from './shared.js';

export async function generateXiaohongshuDraft(
  input: GenerateDraftInput,
): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'xiaohongshu',
    input,
    'Write a Chinese lifestyle-style post with segmented copy and light emoji use.',
  );
}
