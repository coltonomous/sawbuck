import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from './config.js';

const client = new Anthropic();

const MAX_RETRIES = config.claude.maxRetries;
const BASE_DELAY = config.claude.baseDelayMs;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRetryable = err?.status === 429 || err?.status === 529 || err?.status >= 500;
      if (!isRetryable || attempt === MAX_RETRIES - 1) throw err;

      const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(`[claude] Retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(delay)}ms (${err?.status || err?.message})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Should not reach here');
}

export interface ImageInput {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

export async function analyzeWithVision(
  images: ImageInput[],
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  return withRetry(async () => {
    const content: Anthropic.Messages.ContentBlockParam[] = [];

    for (const img of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64,
        },
      });
    }

    content.push({ type: 'text', text: prompt });

    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: config.claude.maxTokens,
      system: systemPrompt || '',
      messages: [{ role: 'user', content }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.text || '';
  });
}

export async function analyzeWithVisionStructured<T>(
  images: ImageInput[],
  prompt: string,
  jsonSchema: Record<string, unknown>,
  zodSchema: z.ZodSchema<T>,
  toolName: string,
  toolDescription: string,
  systemPrompt?: string,
): Promise<T> {
  return withRetry(async () => {
    const content: Anthropic.Messages.ContentBlockParam[] = [];

    for (const img of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64,
        },
      });
    }

    content.push({ type: 'text', text: prompt });

    const response = await client.messages.create({
      model: config.claude.model,
      max_tokens: config.claude.maxTokens,
      system: systemPrompt || '',
      messages: [{ role: 'user', content }],
      tools: [{
        name: toolName,
        description: toolDescription,
        input_schema: jsonSchema as Anthropic.Messages.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: toolName },
    });

    const toolBlock = response.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
    if (!toolBlock) throw new Error('No tool use block in Claude response');
    return zodSchema.parse(toolBlock.input);
  });
}

export async function generateText(
  prompt: string,
  systemPrompt?: string,
  maxTokens = 2000,
  model: 'claude-sonnet-4-20250514' | 'claude-haiku-4-5-20251001' = 'claude-sonnet-4-20250514',
): Promise<string> {
  return withRetry(async () => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt || '',
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.text || '';
  });
}
