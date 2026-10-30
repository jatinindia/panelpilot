import { describe, expect, it } from 'vitest';
import { applyTemplate, baseName, outputFormat, safeName, uniqueNames } from '../src/naming';

describe('baseName', () => {
  it('drops only the last extension', () => {
    expect(baseName('Summer Sale.final.JPG')).toBe('Summer Sale.final');
    expect(baseName('no-extension')).toBe('no-extension');
  });
});

describe('safeName', () => {
  it('keeps case, spaces and unicode but removes characters filesystems reject', () => {
    expect(safeName('Summer Sale: "Final" <v2>/a|b?*')).toBe('Summer Sale Final v2ab');
    expect(safeName('café_é1')).toBe('café_é1');
  });

  it('trims trailing dots and spaces (Windows rejects them)', () => {
    expect(safeName('  hello world. . ')).toBe('hello world');
  });
});

describe('applyTemplate', () => {
  const tokens = { name: 'Summer Sale.JPG', n: 3, total: 4, label: 'Hero Shot' };

  it('uses the original name without its extension', () => {
    expect(applyTemplate('{name}-{n}', tokens)).toBe('Summer Sale-3');
  });

  it('supports the label token and leaves unknown tokens out', () => {
    expect(applyTemplate('{label} {n}{unknown}', tokens)).toBe('Hero Shot 3');
  });

  it('pads the number only as wide as the total needs, so files sort correctly', () => {
    expect(applyTemplate('{n}', { ...tokens, n: 7, total: 9 })).toBe('7');
    expect(applyTemplate('{n}', { ...tokens, n: 7, total: 12 })).toBe('07');
    expect(applyTemplate('{n}', { ...tokens, n: 7, total: 120 })).toBe('007');
  });

  it('falls back to the number when the template renders empty', () => {
    expect(applyTemplate('{unknown}', tokens)).toBe('3');
  });
});

describe('outputFormat', () => {
  it('keeps the original format and extension spelling', () => {
    expect(outputFormat('Summer Sale.JPG', 'image/jpeg', 'original')).toEqual({ format: 'jpeg', extension: 'JPG' });
    expect(outputFormat('a.webp', 'image/webp', 'original')).toEqual({ format: 'webp', extension: 'webp' });
  });

  it('falls back to PNG when the original format cannot be encoded', () => {
    expect(outputFormat('anim.gif', 'image/gif', 'original')).toEqual({ format: 'png', extension: 'png' });
  });

  it('uses a standard extension when converting', () => {
    expect(outputFormat('Summer Sale.JPG', 'image/jpeg', 'png')).toEqual({ format: 'png', extension: 'png' });
    expect(outputFormat('a.png', 'image/png', 'jpeg')).toEqual({ format: 'jpeg', extension: 'jpg' });
  });

  it('keeps the original spelling when the chosen format matches it', () => {
    expect(outputFormat('a.JPEG', 'image/jpeg', 'jpeg')).toEqual({ format: 'jpeg', extension: 'JPEG' });
  });
});

describe('uniqueNames', () => {
  it('suffixes duplicates case-insensitively and keeps the first as-is', () => {
    expect(uniqueNames(['a', 'b', 'A', 'a', 'a-2'])).toEqual(['a', 'b', 'A-2', 'a-3', 'a-2-2']);
  });
});
