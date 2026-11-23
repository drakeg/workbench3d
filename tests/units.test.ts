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
    ['-1-1/2', -1.5],
    ["-2' 6\"", -30],
    ["-2'6-1/2\"", -30.5],
    ['.5mm', 0.5 / 25.4],
    ['1/8', 0.125],
    ['3/16', 0.1875],
    ['3.175mm', 0.125],
    ['4.7625mm', 0.1875],
  ])('%s -> %f', (text, expected) => {
    expect(parseLength(text)).toBeCloseTo(expected, 6);
  });

  it('reads bare numbers as mm in metric', () => {
    expect(parseLength('254', metric)).toBeCloseTo(10, 6);
  });

  it('keeps conversion inputs finite and rejects overflow', () => {
    for (const value of ['9'.repeat(400), '9'.repeat(400) + 'mm', '9'.repeat(400) + 'cm', '9'.repeat(400) + 'm', '9'.repeat(400) + 'in', '9'.repeat(400) + 'ft']) {
      expect(parseLength(value), value.slice(-8)).toBeNull();
    }
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
  it('round-trips exact eighths and sixteenths without approximation', () => {
    for (const inch of [0.125, 0.1875, 1.125, 1.1875]) {
      const label = formatLength(inch);
      expect(label).not.toContain('~');
      expect(parseLength(label)).toBeCloseTo(inch, 10);
    }
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
  it('rejects empty or overflowing coordinates rather than silently dropping them', () => {
    for (const invalid of ['24,,48', '24;', ',48', '24 x ', '24; ;48', ' ', '24, ' + '9'.repeat(400)]) {
      expect(parseLengthList(invalid), invalid).toBeNull();
    }
  });
});
