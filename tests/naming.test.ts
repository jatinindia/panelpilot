import { describe, expect, it } from 'vitest';
import { applyTemplate, safeFileName, uniqueNames } from '../src/naming';

describe('safeFileName', () => {
  it('strips the extension and unsafe characters', () => {
    expect(safeFileName('Summer Sale (Final).PNG')).toBe('summer-sale-final');
  });

  it('keeps unicode letters and digits', () => {
    expect(safeFileName('café_é1.jpg')).toBe('café_é1');
  });

  it('falls back when nothing is left', () => {
    expect(safeFileName('!!!.png')).toBe('image');
  });
});

describe('applyTemplate', () => {
  const tokens = { source: 'Summer Sale.png', n: 3, total: 12, label: 'Hero Shot' };

  it('fills tokens with a zero-padded index', () => {
    expect(applyTemplate('{source}-{n}', tokens)).toBe('summer-sale-03');
  });

  it('supports the label token and leaves unknown tokens out', () => {
    expect(applyTemplate('{label}_{n}{unknown}', tokens)).toBe('hero-shot_03');
  });

  it('pads to the width of the total', () => {
    expect(applyTemplate('{n}', { source: 'a', n: 7, total: 120, label: 'x' })).toBe('007');
  });

  it('falls back to the index when the template renders empty', () => {
    expect(applyTemplate('', tokens)).toBe('03');
  });
});

describe('uniqueNames', () => {
  it('suffixes duplicates case-insensitively and keeps the first as-is', () => {
    expect(uniqueNames(['a', 'b', 'A', 'a', 'a-2'])).toEqual(['a', 'b', 'A-2', 'a-3', 'a-2-2']);
  });
});
