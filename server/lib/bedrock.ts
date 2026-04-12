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
 * Qwen models on Bedrock don't support server-side tool use, so we
 * prompt the model to return JSON and parse it from the text response.
 * The JSON schema is included in the prompt for guidance, and the
 * result is validated with the provided zod schema.
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

    // Include the JSON schema in the prompt so the model knows the expected shape
    const jsonPrompt = prompt + `\n\nRespond with a JSON object matching this schema:\n${JSON.stringify(jsonSchema, null, 2)}\n\nIMPORTANT: Respond with ONLY the JSON object. No markdown, no explanation, no code fences.`;
    content.push({ text: jsonPrompt });

    const system: SystemContentBlock[] = systemPrompt ? [{ text: systemPrompt }] : [];
    const messages: Message[] = [{ role: 'user', content }];

    const response = await bedrock.send(new ConverseCommand({
      modelId: model ?? config.ai.model,
      system,
      messages,
      inferenceConfig: { maxTokens: config.ai.maxTokens },
    }));

    const textBlock = response.output?.message?.content?.find((b) => 'text' in b);
    const rawText = textBlock && 'text' in textBlock ? textBlock.text! : '';

    // Parse JSON — handle markdown wrapping that models sometimes add
    let jsonStr = rawText.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    try {
      const parsed = JSON.parse(jsonStr);
      return zodSchema.parse(parsed);
    } catch (err) {
      logger.error({ model: model ?? config.ai.model, rawText: rawText.slice(0, 500) }, 'Failed to parse structured response as JSON');
      throw new Error(`Failed to parse model response as JSON: ${(err as Error).message}`);
    }
  });
}

/**
 * Plain text generation via Bedrock Converse API.
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
    return textBlock && 'text' in textBlock ? textBlock.text! : '';
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
