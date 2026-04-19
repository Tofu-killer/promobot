import type { GenerateDraftInput, GeneratedDraft } from './types';
import { generatePlatformDraft } from './shared';

export async function generateFacebookGroupDraft(
  input: GenerateDraftInput,
): Promise<GeneratedDraft> {
  return generatePlatformDraft(
    'facebook-group',
    input,
    'Write a friendly Facebook Group post that sounds like a helpful community update.',
  );
}
