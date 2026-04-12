import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from './config.js';
import { withRetry as _withRetry } from './retry.js';

let client: AnthropicBedrock | null = null;

function getClient(): AnthropicBedrock {
  if (!client) {
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    if (!region) {
      throw new Error('AWS_REGION is required for Bedrock. Set AWS_REGION in your environment.');
    }
    client = new AnthropicBedrock({ awsRegion: region });
  }
  return client;
}

function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  return _withRetry(fn, {
    maxRetries: config.claude.maxRetries,
    baseDelayMs: config.claude.baseDelayMs,
    label: 'claude',
  });
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
  const claude = getClient();
  return withRetry(async () => {
    const content: Anthropic.Messages.ContentBlockParam[] = [];

    for (const img of images) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      });
    }

    content.push({ type: 'text', text: prompt });

    const response = await claude.messages.create({
      model: config.claude.model,
      max_tokens: config.claude.maxTokens,
      system: systemPrompt || '',
      messages: [{ role: 'user', content }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock && 'text' in textBlock ? textBlock.text : '';
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
  model?: string,
): Promise<T> {
  const claude = getClient();
  return withRetry(async () => {
    const content: Anthropic.Messages.ContentBlockParam[] = [];

    for (const img of images) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      });
    }

    content.push({ type: 'text', text: prompt });

    const response = await claude.messages.create({
      model: model ?? config.claude.model,
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
  model?: string,
): Promise<string> {
  const claude = getClient();
  return withRetry(async () => {
    const response = await claude.messages.create({
      model: model ?? config.claude.model,
      max_tokens: maxTokens,
      system: systemPrompt || '',
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock && 'text' in textBlock ? textBlock.text : '';
  });
}
