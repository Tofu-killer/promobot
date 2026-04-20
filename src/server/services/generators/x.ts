import type { GenerateDraftInput, GeneratedDraft } from './types.js';
import { generatePlatformDraft } from './shared.js';

export async function generateXDraft(input: GenerateDraftInput): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'x',
    input,
    'Write a concise English social post with a strong hook and a clear call to action.',
  );
}
