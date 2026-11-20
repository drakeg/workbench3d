import { describe, expect, it } from 'vitest';
import { estimateStockCost, money, parseStockPrice } from '../src/core/materialCost';

describe('cut-list purchase estimates', () => {
  it('prices the number of whole sheets and boards, not the part board-foot volume', () => {
    const r = estimateStockCost([
      { key: 'plywood', label: 'Plywood 3/4', count: 2, unitPrice: 48.75, unplaced: 0 },
      { key: 'pine', label: 'Pine', count: 3, unitPrice: 6.25, unplaced: 0 },
    ]);
    expect(r.lines[0].extended).toBe(97.5);
    expect(r.lines[1].extended).toBe(18.75);
    expect(r.quotedSubtotal).toBe(116.25);
    expect(r.grandTotal).toBe(116.25);
    expect(r.missingQuotes).toBe(0);
  });

  it('distinguishes unpriced material from a user-entered zero-dollar stock item', () => {
    const missing = estimateStockCost([
      { key: 'a', label: 'Plywood', count: 1, unitPrice: 0, unplaced: 0 },
      { key: 'b', label: 'Boards', count: 2, unitPrice: null, unplaced: 0 },
    ]);
    expect(missing.quotedSubtotal).toBe(0);
    expect(missing.grandTotal).toBeNull();
    expect(missing.missingQuotes).toBe(1);
    expect(money(null)).toBe('Not quoted');
    expect(money(0)).toBe('$0.00');
  });

  it('marks an estimate incomplete when parts cannot fit on stock', () => {
    const r = estimateStockCost([{ key: 'x', label: 'Sheet', count: 2, unitPrice: 25, unplaced: 1 }]);
    expect(r.quotedSubtotal).toBe(50);
    expect(r.grandTotal).toBeNull();
    expect(r.unplacedParts).toBe(1);
  });

  it('parses prices as dollars without accepting negatives, currency, scientific notation or partial numbers', () => {
    expect(parseStockPrice(' 12.50 ')).toBe(12.5);
    expect(parseStockPrice('0')).toBe(0);
    for (const bad of ['', ' ', '-1', '1.234', '10.', '$10', '1e3', 'abc', 'Infinity', '01', '1,000']) {
      expect(parseStockPrice(bad), bad).toBeNull();
    }
  });

  it('rejects invalid source data and arithmetic overflow', () => {
    expect(() => estimateStockCost([{ key: 'x', label: 'X', count: -1, unitPrice: 1, unplaced: 0 }])).toThrow();
    expect(() => estimateStockCost([{ key: 'x', label: 'X', count: 2, unitPrice: -3, unplaced: 0 }])).toThrow();
    expect(() => estimateStockCost([{ key: 'x', label: 'X', count: 1, unitPrice: Infinity, unplaced: 0 }])).toThrow();
    expect(() => estimateStockCost([{ key: 'x', label: 'X', count: 2_000_000, unitPrice: 999999999999, unplaced: 0 }])).toThrow();
  });
});
