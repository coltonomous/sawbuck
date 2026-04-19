import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { config } from './config.js';
import { withRetry as _withRetry } from './retry.js';
import logger from './logger.js';

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    if (!region) {
      throw new Error('AWS_REGION is required for Bedrock. Set AWS_REGION in your environment.');
    }
    client = new BedrockRuntimeClient({ region });
  }
  return client;
}

function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return _withRetry(fn, {
    maxRetries: config.ai.maxRetries,
    baseDelayMs: config.ai.baseDelayMs,
    label: 'bedrock',
  });
}

export interface ImageInput {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

/**
 * Extract JSON from model text output, handling common LLM response patterns:
 * - Qwen3 thinking tags: <think>...</think>{json}
 * - Markdown code fences: ```json\n{...}\n```
 * - Leading/trailing prose: "Here is the JSON:\n{...}\nLet me know..."
 * - Clean JSON (ideal case)
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  // Strip Qwen3 thinking tags
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Try markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return sanitizeJson(fenceMatch[1].trim());

  // Try to find a JSON object or array by matching balanced braces/brackets
  const jsonStart = text.search(/[{\[]/);
  if (jsonStart === -1) return text;

  const opener = text[jsonStart];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return sanitizeJson(text.slice(jsonStart, i + 1));
    }
  }

  // Couldn't find balanced braces — return from first brace to end (may be truncated)
  return sanitizeJson(text.slice(jsonStart));
}

function sanitizeJson(json: string): string {
  // Fix bare decimals like .1 → 0.1 (valid JS but not valid JSON)
  let out = json.replace(/([^.\d]|^)(\.\d+)/g, '$10$2');
  // Escape unescaped quotes and literal control chars inside string values
  out = fixStringContents(out);
  // Remove trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

/**
 * Walk the JSON and repair common LLM mistakes inside string literals:
 *   - unescaped double quotes (the model wrote `"he said "hi""` instead of `"he said \"hi\""`)
 *   - literal control characters (raw newlines, tabs) inside a string
 *
 * Heuristic for deciding whether a `"` inside a string is the real closing
 * quote or an unescaped inner one: look ahead past whitespace. If the next
 * non-whitespace character is one of `,`, `}`, `]`, `:`, or end-of-input,
 * it's the closing quote. Otherwise escape it and keep scanning.
 */
function fixStringContents(json: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (!inString) {
      result += ch;
      if (ch === '"') inString = true;
      continue;
    }

    if (escape) {
      result += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < json.length && (json[j] === ' ' || json[j] === '\t' || json[j] === '\n' || json[j] === '\r')) j++;
      const next = j < json.length ? json[j] : '';
      if (next === '' || next === ',' || next === '}' || next === ']' || next === ':') {
        result += ch;
        inString = false;
      } else {
        result += '\\"';
      }
      continue;
    }

    // Escape raw control characters that are illegal inside a JSON string
    if (ch === '\n') { result += '\\n'; continue; }
    if (ch === '\r') { result += '\\r'; continue; }
    if (ch === '\t') { result += '\\t'; continue; }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      result += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Call Bedrock Converse API with optional images and return plain text.
 */
export async function analyzeWithVision(
  images: ImageInput[],
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  const bedrock = getClient();
  return withRetry(async () => {
    const content: ContentBlock[] = [];

    for (const img of images) {
      content.push({
        image: {
          format: mediaTypeToFormat(img.mediaType),
          source: { bytes: Buffer.from(img.base64, 'base64') },
        },
      });
    }

    content.push({ text: prompt });

    const system: SystemContentBlock[] = systemPrompt ? [{ text: systemPrompt }] : [];
    const messages: Message[] = [{ role: 'user', content }];

    const response = await bedrock.send(new ConverseCommand({
      modelId: config.ai.model,
      system,
      messages,
      inferenceConfig: { maxTokens: config.ai.maxTokens },
    }));

    const textBlock = response.output?.message?.content?.find((b) => 'text' in b);
    return textBlock && 'text' in textBlock ? textBlock.text! : '';
  });
}

/**
 * Call Bedrock Converse API and extract structured JSON output.
 *
 * The JSON schema is included in the prompt for guidance, and the
 * result is extracted from the text response and validated with zod.
 * Handles Qwen3 thinking tags, markdown fences, and leading prose.
 */
export async function analyzeWithVisionStructured<T>(
  images: ImageInput[],
  prompt: string,
  jsonSchema: Record<string, unknown>,
  zodSchema: z.ZodSchema<T>,
  _toolName: string,
  _toolDescription: string,
  systemPrompt?: string,
  model?: string,
  maxTokens?: number,
): Promise<T> {
  const bedrock = getClient();
  return withRetry(async () => {
    const content: ContentBlock[] = [];

    for (const img of images) {
      content.push({
        image: {
          format: mediaTypeToFormat(img.mediaType),
          source: { bytes: Buffer.from(img.base64, 'base64') },
        },
      });
    }

    const jsonPrompt = prompt + `\n\nRespond with a JSON object matching this schema:\n${JSON.stringify(jsonSchema, null, 2)}\n\nIMPORTANT: Respond with ONLY the JSON object. No markdown, no explanation, no code fences, no thinking.`;
    content.push({ text: jsonPrompt });

    const system: SystemContentBlock[] = systemPrompt ? [{ text: systemPrompt }] : [];
    const messages: Message[] = [{ role: 'user', content }];

    const response = await bedrock.send(new ConverseCommand({
      modelId: model ?? config.ai.model,
      system,
      messages,
      inferenceConfig: { maxTokens: maxTokens ?? config.ai.maxTokens },
    }));

    const textBlock = response.output?.message?.content?.find((b) => 'text' in b);
    const rawText = textBlock && 'text' in textBlock ? textBlock.text! : '';
    const jsonStr = extractJson(rawText);

    try {
      const parsed = JSON.parse(jsonStr);
      return zodSchema.parse(parsed);
    } catch (err) {
      const message = (err as Error).message;
      const posMatch = message.match(/position (\d+)/);
      const context = posMatch
        ? jsonStr.slice(Math.max(0, Number(posMatch[1]) - 80), Number(posMatch[1]) + 80)
        : undefined;
      logger.error({
        model: model ?? config.ai.model,
        rawText: rawText.slice(0, 500),
        extracted: jsonStr.slice(0, 500),
        failureContext: context,
      }, 'Failed to parse structured response');
      throw new Error(`Failed to parse model response as JSON: ${message}`);
    }
  });
}

/**
 * Plain text generation via Bedrock Converse API.
 * Strips Qwen3 thinking tags from the response.
 */
export async function generateText(
  prompt: string,
  systemPrompt?: string,
  maxTokens = 2000,
  model?: string,
): Promise<string> {
  const bedrock = getClient();
  return withRetry(async () => {
    const system: SystemContentBlock[] = systemPrompt ? [{ text: systemPrompt }] : [];
    const messages: Message[] = [{ role: 'user', content: [{ text: prompt }] }];

    const response = await bedrock.send(new ConverseCommand({
      modelId: model ?? config.ai.model,
      system,
      messages,
      inferenceConfig: { maxTokens },
    }));

    const textBlock = response.output?.message?.content?.find((b) => 'text' in b);
    const raw = textBlock && 'text' in textBlock ? textBlock.text! : '';
    // Strip thinking tags from text output too
    return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  });
}

function mediaTypeToFormat(mediaType: string): 'jpeg' | 'png' | 'webp' | 'gif' {
  switch (mediaType) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: return 'jpeg';
  }
}
