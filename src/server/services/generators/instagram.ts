import type { GenerateDraftInput, GeneratedDraft } from './types.js';
import { generatePlatformDraft } from './shared.js';

export async function generateInstagramDraft(
  input: GenerateDraftInput,
): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'instagram',
    input,
    'Write an Instagram caption with a strong opening hook, concise value bullets, and a clear CTA.',
  );
}
