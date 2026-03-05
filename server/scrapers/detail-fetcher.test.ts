import { describe, it, expect } from 'vitest';
import { stripKeywordSpam } from './detail-fetcher.js';

describe('stripKeywordSpam', () => {
  it('returns clean descriptions unchanged', () => {
    const desc = 'Beautiful mid-century dresser in great condition.\n\nSolid walnut, original hardware.';
    expect(stripKeywordSpam(desc)).toBe(desc);
  });

  it('strips stock code + keyword spam at end', () => {
    const clean = 'Nice dresser for sale. Solid wood construction.';
    const spam = 'SV1767\nmcm eames era danish modern teak walnut oak mahogany vintage retro antique furniture dresser chest bureau credenza sideboard buffet console table desk nightstand end table coffee table';
    const desc = `${clean}\n\n${spam}`;
    expect(stripKeywordSpam(desc)).toBe(clean);
  });

  it('strips keyword blocks without stock code (500+ chars, few newlines)', () => {
    const clean = 'Solid oak dresser.\n\nGood condition, minor wear.';
    const spam = 'a '.repeat(300); // 600 chars, no newlines
    const desc = `${clean}\n\n${spam.trim()}`;
    expect(stripKeywordSpam(desc)).toBe(clean);
  });

  it('does not strip legitimate long paragraphs with newlines', () => {
    const clean = 'Solid oak dresser.';
    const longParagraph = ('This is a sentence.\n').repeat(60); // 60 lines = has newlines
    const desc = `${clean}\n\n${longParagraph.trim()}`;
    // Should NOT be stripped because it has many newlines
    expect(stripKeywordSpam(desc)).toBe(desc);
  });

  it('handles description with only one paragraph', () => {
    const desc = 'Simple listing description.';
    expect(stripKeywordSpam(desc)).toBe(desc);
  });

  it('handles empty string', () => {
    expect(stripKeywordSpam('')).toBe('');
  });

  it('strips code pattern like AB123 followed by keywords', () => {
    const clean = 'Great vintage table.';
    const spam = 'AB12\nkeyword spam that goes on and on and on';
    const desc = `${clean}\n\n${spam}`;
    expect(stripKeywordSpam(desc)).toBe(clean);
  });
});
