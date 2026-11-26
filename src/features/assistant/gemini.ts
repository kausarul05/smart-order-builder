/**
 * Part F - the Gemini client.
 *
 * The key is read from `import.meta.env.VITE_GEMINI_API_KEY`. It lives in
 * `.env.local`, which is git-ignored; `.env.example` ships with the name
 * and no value. The real key goes in the submission form, never in a commit.
 *
 * TODO(Part F): one `askAssistant` round trip -
 *   1  send the question with `functionDeclarations()` and SYSTEM_INSTRUCTION
 *   2  read the functionCall the model chose
 *   3  run `toolByName(call.name).run(call.args, context)` locally
 *   4  send the result back as a functionResponse
 *   5  return the model's sentence
 * The orders themselves are never put in a prompt.
 */

export type AssistantErrorKind =
  | 'missing-key'
  | 'invalid-key'
  | 'unknown-model'
  | 'quota'
  | 'network'
  | 'blocked'
  | 'unknown';

export class AssistantError extends Error {
  readonly kind: AssistantErrorKind;

  constructor(kind: AssistantErrorKind, message: string) {
    super(message);
    this.name = 'AssistantError';
    this.kind = kind;
  }
}

/** The message the chat panel shows for each failure the brief lists. */
export const ASSISTANT_ERROR_MESSAGE: Readonly<Record<AssistantErrorKind, string>> = {
  'missing-key':
    'No Gemini API key found. Copy .env.example to .env.local, put a free Google AI Studio key in VITE_GEMINI_API_KEY and restart the dev server.',
  'invalid-key':
    'Gemini rejected this API key. Check that it was copied whole from Google AI Studio.',
  'unknown-model':
    'That Gemini model is not available for this key. Google retires model ids - set VITE_GEMINI_MODEL in .env.local to a current Flash model from Google AI Studio.',
  quota:
    'The free Gemini quota is used up for now (HTTP 429). Wait a minute and ask again.',
  network: 'Could not reach Gemini. Check your internet connection and try again.',
  blocked: 'Gemini declined to answer that one. Try rephrasing the question.',
  unknown: 'The assistant failed unexpectedly. See the console for details.',
};

/**
 * Google retires model ids: gemini-2.0-flash was shut down on 1 June 2026.
 * Flash-Lite is chosen over the newest Flash because its free-tier daily
 * request allowance is far larger, and this app makes two calls per
 * question. Override with VITE_GEMINI_MODEL if the id moves again.
 */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export interface GeminiConfig {
  readonly apiKey: string;
  readonly model: string;
}

/** Reads and validates the key without ever logging it. */
export function readGeminiConfig(): GeminiConfig {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();
  const model = (import.meta.env.VITE_GEMINI_MODEL ?? DEFAULT_MODEL).trim();
  if (apiKey.length === 0) {
    throw new AssistantError('missing-key', ASSISTANT_ERROR_MESSAGE['missing-key']);
  }
  return { apiKey, model };
}

/** Maps an SDK or HTTP failure onto the taxonomy above. */
export function classifyGeminiError(cause: unknown): AssistantError {
  if (cause instanceof AssistantError) return cause;

  const status =
    typeof cause === 'object' && cause !== null && 'status' in cause
      ? Number((cause as { status: unknown }).status)
      : Number.NaN;
  const text = cause instanceof Error ? cause.message : String(cause);

  if (status === 429 || /quota|rate.?limit/i.test(text)) {
    return new AssistantError('quota', ASSISTANT_ERROR_MESSAGE.quota);
  }
  // A retired or mistyped model id is a 404, and it is the failure most
  // likely to greet someone running this months from now.
  if (status === 404 || /not found|is not supported|unsupported model/i.test(text)) {
    return new AssistantError('unknown-model', ASSISTANT_ERROR_MESSAGE['unknown-model']);
  }
  if (status === 400 || status === 401 || status === 403 || /api.?key/i.test(text)) {
    return new AssistantError('invalid-key', ASSISTANT_ERROR_MESSAGE['invalid-key']);
  }
  if (/fetch|network|ENOTFOUND|ECONNREFUSED/i.test(text)) {
    return new AssistantError('network', ASSISTANT_ERROR_MESSAGE.network);
  }
  if (/safety|blocked/i.test(text)) {
    return new AssistantError('blocked', ASSISTANT_ERROR_MESSAGE.blocked);
  }
  return new AssistantError('unknown', ASSISTANT_ERROR_MESSAGE.unknown);
}
