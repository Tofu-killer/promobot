import type { GenerateDraftInput, GeneratedDraft } from './types.js';
import { generatePlatformDraft } from './shared.js';

export async function generateRedditDraft(input: GenerateDraftInput): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'reddit',
    input,
    'Write an English Reddit-style post that reads naturally and stays technical.',
  );
}
