import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, parseLengthList, roundDisplayDecimal } from '../src/core/units';

const metric = { system: 'metric' as const, fraction: 16, mmDecimals: 0 };

describe('parseLength', () => {
  it.each([
    ['12', 12],
    ['12"', 12],
    ['3/4', 0.75],
    ['1 1/2', 1.5],
    ['1-1/2"', 1.5],
    ["2'", 24],
    ["2' 6\"", 30],
    ["2'6-1/2\"", 30.5],
    ['25.4mm', 1],
    ['2.54cm', 1],
    ['-3', -3],
    ['-1-1/2', -1.5],
    ["-2' 6\"", -30],
    ["-2'6-1/2\"", -30.5],
    ['.5mm', 0.5 / 25.4],
  ])('%s -> %f', (text, expected) => {
    expect(parseLength(text)).toBeCloseTo(expected, 6);
  });

  it('reads bare numbers as mm in metric', () => {
    expect(parseLength('254', metric)).toBeCloseTo(10, 6);
  });

  it('rejects junk', () => {
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
    for (const invalid of ['1..2mm', '2.3.4cm', '1..5ft', '3/0', '1 1/0', '-1-1/0', "2' 12\"", "2' -3\""]) {
      expect(parseLength(invalid), invalid).toBeNull();
    }
  });
});

describe('formatLength', () => {
  it('formats fractions and feet', () => {
    expect(formatLength(1.5)).toBe('1 1/2"');
    expect(formatLength(0.75)).toBe('3/4"');
    expect(formatLength(30.5)).toBe(`2' 6 1/2"`);
    expect(formatLength(24)).toBe(`2' 0"`);
  });
  it('flags rounding', () => {
    expect(formatLength(0.1)).toBe('~ 1/8"');
  });
  it('formats metric', () => {
    expect(formatLength(1, metric)).toBe('25 mm');
  });
  it('rounds half-millimetre display boundaries without binary float bias', () => {
    const precise = { ...metric, mmDecimals: 2 };
    expect(formatLength(0.125, precise)).toBe('3.18 mm');
    expect(formatLength(-0.125, precise)).toBe('-3.18 mm');
    expect(formatLength(0.1875, precise)).toBe('4.76 mm');
    expect(formatLength(0.5, precise)).toBe('12.7 mm');
    expect(formatLength(0.125, { ...metric, mmDecimals: 3 })).toBe('3.175 mm');
  });
});

describe('parseLengthList', () => {
  it('splits on commas and x', () => {
    expect(parseLengthList('24, 48')).toEqual([24, 48]);
    expect(parseLengthList("2'x4'")).toEqual([24, 48]);
    expect(parseLengthList('3/4;1 1/2')).toEqual([0.75, 1.5]);
  });
});

describe('roundDisplayDecimal', () => {
  it('rounds exact positive and negative half steps away from zero', () => {
    expect(roundDisplayDecimal(3.175, 2)).toBe(3.18);
    expect(roundDisplayDecimal(-3.175, 2)).toBe(-3.18);
    expect(roundDisplayDecimal(0.1875, 3)).toBe(0.188);
    expect(roundDisplayDecimal(-0.1875, 3)).toBe(-0.188);
    expect(roundDisplayDecimal(1.234, 2)).toBe(1.23);
  });
  it('rejects nonfinite lengths and unsupported precision', () => {
    expect(() => roundDisplayDecimal(Infinity, 2)).toThrow();
    expect(() => roundDisplayDecimal(NaN, 2)).toThrow();
    expect(() => roundDisplayDecimal(1, -1)).toThrow();
    expect(() => roundDisplayDecimal(1, 11)).toThrow();
  });
});
