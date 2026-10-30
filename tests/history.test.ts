import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from '../src/history';

describe('history', () => {
  it('undoes and redoes in order', () => {
    const h = pushHistory(pushHistory(createHistory('a'), 'b', 10), 'c', 10);
    expect(h.present).toBe('c');
    const u1 = undo(h);
    expect(u1.present).toBe('b');
    const u2 = undo(u1);
    expect(u2.present).toBe('a');
    expect(canUndo(u2)).toBe(false);
    expect(redo(redo(u2)).present).toBe('c');
  });

  it('drops the redo stack when a new state is pushed', () => {
    const h = pushHistory(undo(pushHistory(createHistory(1), 2, 10)), 3, 10);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(false);
  });

  it('keeps at most `limit` past states', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 5; i++) h = pushHistory(h, i, 3);
    expect(h.past).toEqual([2, 3, 4]);
  });

  it('is a no-op to undo or redo at the ends', () => {
    const h = createHistory('x');
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
