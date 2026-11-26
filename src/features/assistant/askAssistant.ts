/**
 * Part F - one question, one answer, through Gemini function calling.
 *
 * The contract, which is what TC-18 to TC-20 actually test:
 *
 *   1. The orders are NEVER put in a prompt. Only the question and the tool
 *      declarations go to the model.
 *   2. The model picks one of our tools. We run it locally over the live
 *      order store, so the figure is computed by our code.
 *   3. The model gets the tool result back and only phrases it.
 *   4. If it picks no tool, the answer is marked `grounded: false` and the
 *      panel says no data was used - which is how "Who is our best
 *      customer?" is answered without inventing a name (TC-20, D5).
 *
 * The call is a plain `fetch` rather than the SDK: the key travels in the
 * `x-goog-api-key` header instead of a query string, and MSW can intercept
 * it in tests exactly like any other request.
 */

import { toolByName, functionDeclarations, SYSTEM_INSTRUCTION, type ToolContext, type ToolResult } from './tools';
import {
  AssistantError,
  ASSISTANT_ERROR_MESSAGE,
  classifyGeminiError,
  readGeminiConfig,
} from './gemini';

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** The reply when the question cannot be served by any tool. */
export const NO_TOOL_FALLBACK =
  'I can only answer from the order data, and these orders hold no information of that kind. I can tell you the order count, total revenue, average order value, the best-selling option, revenue by payment method, coupon usage, or the orders on a given date.';

export interface AssistantAnswer {
  readonly text: string;
  /** Which tool produced the figure, or null when none was called. */
  readonly toolName: string | null;
  readonly toolResult: ToolResult | null;
  /** True only when every figure in `text` came from a tool result. */
  readonly grounded: boolean;
}

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: {
    readonly name: string;
    readonly args?: Record<string, unknown>;
    /**
     * Newer API versions tag each call. When one is present it MUST come
     * back on the functionResponse, or the model cannot match the result
     * to the call it made.
     */
    readonly id?: string;
  };
}

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly GeminiPart[] };
    readonly finishReason?: string;
  }[];
  readonly promptFeedback?: { readonly blockReason?: string };
}

export interface AskOptions {
  /** Injected by the tests; defaults to the real endpoint. */
  readonly endpoint?: string;
  readonly signal?: AbortSignal;
}

export async function askAssistant(
  question: string,
  context: ToolContext,
  options: AskOptions = {},
): Promise<AssistantAnswer> {
  const config = readGeminiConfig();
  const endpoint = options.endpoint ?? GEMINI_ENDPOINT;
  const url = `${endpoint}/${config.model}:generateContent`;

  const call = async (contents: unknown[]): Promise<GeminiResponse> => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The key goes in a header, never in the URL.
          'x-goog-api-key': config.apiKey,
        },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents,
          tools: [{ functionDeclarations: functionDeclarations() }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          // Deterministic phrasing of a fixed figure.
          generationConfig: { temperature: 0 },
        }),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new AssistantError('network', ASSISTANT_ERROR_MESSAGE.network);
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      throw classifyGeminiError({
        status: response.status,
        message: extractMessage(body) ?? `Gemini returned ${response.status}`,
      });
    }

    return (await response.json()) as GeminiResponse;
  };

  const userTurn = { role: 'user', parts: [{ text: question }] };

  const first = await call([userTurn]);
  if (first.promptFeedback?.blockReason !== undefined) {
    throw new AssistantError('blocked', ASSISTANT_ERROR_MESSAGE.blocked);
  }

  const parts = first.candidates?.[0]?.content?.parts ?? [];
  const functionCall = parts.find((part) => part.functionCall !== undefined)?.functionCall;

  // No tool: the model answered from nothing, so nothing it says is a figure
  // we stand behind.
  if (functionCall === undefined) {
    const spoken = joinText(parts).trim();
    return {
      text: spoken.length > 0 ? spoken : NO_TOOL_FALLBACK,
      toolName: null,
      toolResult: null,
      grounded: false,
    };
  }

  const tool = toolByName(functionCall.name);
  if (tool === undefined) {
    // It asked for something we do not have. Answer ourselves rather than
    // letting it improvise.
    return {
      text: NO_TOOL_FALLBACK,
      toolName: null,
      toolResult: null,
      grounded: false,
    };
  }

  // The figure is computed HERE, by our own pure function, over the live
  // order store. This is what makes TC-18 differ by exactly one.
  const toolResult = tool.run(functionCall.args ?? {}, context);

  const second = await call([
    userTurn,
    { role: 'model', parts: [{ functionCall }] },
    {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: tool.name,
            // Echo the call id back when the model supplied one.
            ...(functionCall.id === undefined ? {} : { id: functionCall.id }),
            response: { result: toolResult },
          },
        },
      ],
    },
  ]);

  const phrased = joinText(second.candidates?.[0]?.content?.parts ?? []).trim();

  return {
    text: phrased.length > 0 ? phrased : describeFallback(tool.name, toolResult),
    toolName: tool.name,
    toolResult,
    grounded: true,
  };
}

function joinText(parts: readonly GeminiPart[]): string {
  return parts
    .map((part) => part.text ?? '')
    .filter((text) => text.length > 0)
    .join('\n');
}

/** If the model says nothing useful, show the raw figure rather than silence. */
function describeFallback(toolName: string, result: ToolResult): string {
  return `${toolName}: ${JSON.stringify(result)}`;
}

function extractMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const { error } = body as { error?: { message?: unknown } };
  return typeof error?.message === 'string' ? error.message : null;
}
