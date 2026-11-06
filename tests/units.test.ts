import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, parseLengthList } from '../src/core/units';

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
  ])('%s -> %f', (text, expected) => {
    expect(parseLength(text)).toBeCloseTo(expected, 6);
  });

  it('reads bare numbers as mm in metric', () => {
    expect(parseLength('254', metric)).toBeCloseTo(10, 6);
  });

  it('rejects junk', () => {
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
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
});

describe('parseLengthList', () => {
  it('splits on commas and x', () => {
    expect(parseLengthList('24, 48')).toEqual([24, 48]);
    expect(parseLengthList("2'x4'")).toEqual([24, 48]);
    expect(parseLengthList('3/4;1 1/2')).toEqual([0.75, 1.5]);
  });
});
