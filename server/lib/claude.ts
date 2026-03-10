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

/**
 * Analyze images with Claude Vision using tool use for guaranteed structured output.
 * Returns parsed + validated data matching the provided Zod schema.
 */
export async function analyzeWithVisionStructured<T>(
  images: ImageInput[],
  prompt: string,
  schema: z.ZodSchema<T>,
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

    // Convert Zod schema to JSON Schema for tool use
    const jsonSchema = zodToJsonSchema(schema);

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
    return schema.parse(toolBlock.input);
  });
}

/**
 * Convert a Zod schema to a JSON Schema object compatible with Anthropic tool use.
 * Handles the common Zod types used in this codebase.
 */
function zodToJsonSchema(schema: z.ZodSchema): Record<string, unknown> {
  const def = (schema as any)._zpiDef || (schema as any)._def;

  // Zod v4 uses _zpiDef; v3 uses _def. Handle both.
  if (!def) {
    // Fallback: try to get shape from the schema
    return { type: 'object' };
  }

  const typeName = def.typeName || def.type;

  switch (typeName) {
    case 'ZodObject':
    case 'object': {
      const shape = def.shape || (typeof def.shape === 'function' ? def.shape() : {});
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value as z.ZodSchema);
        // Check if field is optional
        const valDef = (value as any)._zpiDef || (value as any)._def;
        const valType = valDef?.typeName || valDef?.type;
        if (valType !== 'ZodOptional') {
          required.push(key);
        }
      }
      return { type: 'object', properties, required };
    }
    case 'ZodString':
    case 'string':
      return { type: 'string' };
    case 'ZodNumber':
    case 'number': {
      const result: Record<string, unknown> = { type: 'number' };
      const checks = def.checks || [];
      for (const check of checks) {
        if (check.kind === 'min') result.minimum = check.value;
        if (check.kind === 'max') result.maximum = check.value;
      }
      return result;
    }
    case 'ZodBoolean':
    case 'boolean':
      return { type: 'boolean' };
    case 'ZodArray':
    case 'array':
      return { type: 'array', items: zodToJsonSchema(def.type || def.innerType) };
    case 'ZodEnum':
    case 'enum':
      return { type: 'string', enum: def.values || def.entries };
    case 'ZodNullable':
    case 'nullable': {
      const inner = zodToJsonSchema(def.innerType);
      return { ...inner, nullable: true };
    }
    case 'ZodOptional':
    case 'optional':
      return zodToJsonSchema(def.innerType);
    default:
      return {};
  }
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
