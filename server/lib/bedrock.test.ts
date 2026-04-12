import { describe, it, expect } from 'vitest';
import { extractJson } from './bedrock.js';

describe('extractJson', () => {
  it('extracts clean JSON object', () => {
    expect(extractJson('{"key": "value"}')).toBe('{"key": "value"}');
  });

  it('extracts clean JSON array', () => {
    expect(extractJson('[1, 2, 3]')).toBe('[1, 2, 3]');
  });

  it('strips Qwen3 thinking tags', () => {
    const raw = '<think>Let me analyze this carefully...</think>{"result": true}';
    expect(extractJson(raw)).toBe('{"result": true}');
  });

  it('strips multiple thinking blocks', () => {
    const raw = '<think>first</think>some text<think>second</think>{"key": 1}';
    expect(extractJson(raw)).toBe('{"key": 1}');
  });

  it('extracts from markdown code fences', () => {
    const raw = '```json\n{"assessments": [1, 2]}\n```';
    expect(extractJson(raw)).toBe('{"assessments": [1, 2]}');
  });

  it('extracts from code fences without json label', () => {
    const raw = '```\n{"key": "val"}\n```';
    expect(extractJson(raw)).toBe('{"key": "val"}');
  });

  it('extracts JSON after leading prose', () => {
    const raw = 'Here is the analysis:\n\n{"type": "dresser", "score": 7}';
    const result = JSON.parse(extractJson(raw));
    expect(result.type).toBe('dresser');
    expect(result.score).toBe(7);
  });

  it('extracts JSON before trailing prose', () => {
    const raw = '{"done": true}\n\nLet me know if you need more details.';
    expect(extractJson(raw)).toBe('{"done": true}');
  });

  it('handles nested braces correctly', () => {
    const raw = '{"outer": {"inner": {"deep": true}}}';
    const result = JSON.parse(extractJson(raw));
    expect(result.outer.inner.deep).toBe(true);
  });

  it('handles strings with braces inside', () => {
    const raw = '{"text": "this has {braces} inside"}';
    const result = JSON.parse(extractJson(raw));
    expect(result.text).toBe('this has {braces} inside');
  });

  it('handles escaped quotes in strings', () => {
    const raw = '{"text": "she said \\"hello\\""}';
    const result = JSON.parse(extractJson(raw));
    expect(result.text).toBe('she said "hello"');
  });

  it('returns original text when no JSON found', () => {
    expect(extractJson('no json here at all')).toBe('no json here at all');
  });

  it('handles empty string', () => {
    expect(extractJson('')).toBe('');
  });

  it('handles thinking tags + code fence combo', () => {
    const raw = '<think>reasoning</think>\n```json\n{"answer": 42}\n```';
    expect(extractJson(raw)).toBe('{"answer": 42}');
  });

  it('extracts array from mixed content', () => {
    const raw = 'The results are: [{"id": 1}, {"id": 2}] as requested.';
    const result = JSON.parse(extractJson(raw));
    expect(result).toHaveLength(2);
  });
});
