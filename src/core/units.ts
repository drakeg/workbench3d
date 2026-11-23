/**
 * Length units. Internally every length is stored in INCHES.
 * Parsing accepts the forms woodworkers and metal workers actually type:
 *   12   12"   3/4   1 1/2   1-1/2"   2'   2' 6"   2'6-1/2"   30mm   2.5cm   1.2m
 */

export type UnitSystem = 'imperial' | 'metric';

export interface UnitSettings {
  system: UnitSystem;
  /** Imperial: denominator of the smallest fraction shown (e.g. 16 => 1/16"). */
  fraction: number;
  /** Metric: decimal places shown for millimetres. */
  mmDecimals: number;
}

export const defaultUnits: UnitSettings = { system: 'imperial', fraction: 16, mmDecimals: 0 };

export const MM_PER_INCH = 25.4;

function parseNumberish(s: string): number | null {
  s = s.trim();
  if (!s) return null;
  // "1 1/2" or "1-1/2"
  const mixed = s.match(/^(-?\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = parseFloat(mixed[1]);
    const denominator = parseInt(mixed[3], 10);
    if (denominator === 0) return null;
    const frac = parseInt(mixed[2], 10) / denominator;
    return mixed[1].startsWith('-') ? whole - frac : whole + frac;
  }
  const frac = s.match(/^(-?)(\d+)\/(\d+)$/);
  if (frac) {
    const denominator = parseInt(frac[3], 10);
    if (denominator === 0) return null;
    const v = parseInt(frac[2], 10) / denominator;
    return frac[1] ? -v : v;
  }
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
  return null;
}

/**
 * Parse a typed length. Returns inches, or null if the text is not a length.
 * A bare number is read in the current unit system (inches or millimetres).
 */
export function parseLength(text: string, units: UnitSettings = defaultUnits): number | null {
  let s = text.trim().toLowerCase().replace(/′/g, "'").replace(/″/g, '"').replace(/''/g, '"');
  if (!s) return null;

  const metric = s.match(/^(-?(?:\d+\.?\d*|\.\d+))\s*(mm|cm|m)$/);
  if (metric) {
    const v = parseFloat(metric[1]);
    if (isNaN(v)) return null;
    const mm = metric[2] === 'mm' ? v : metric[2] === 'cm' ? v * 10 : v * 1000;
    const inches = mm / MM_PER_INCH;
    return Number.isFinite(inches) ? inches : null;
  }

  // feet and optional inches: 2'  2' 6"  2'6-1/2"
  const feet = s.match(/^(-?(?:\d+\.?\d*|\.\d+))\s*(?:'|ft)\s*(.*)$/);
  if (feet) {
    const f = parseFloat(feet[1]);
    if (isNaN(f)) return null;
    let rest = feet[2].trim().replace(/("|in)$/, '').trim();
    let inches = 0;
    if (rest) {
      const v = parseNumberish(rest);
      if (v === null || v < 0 || v >= 12) return null;
      inches = v;
    }
    const sign = f < 0 || feet[1].startsWith('-') ? -1 : 1;
    const total = sign * (Math.abs(f) * 12 + inches);
    return Number.isFinite(total) ? total : null;
  }

  const inch = s.match(/^(.*?)\s*("|in)$/);
  if (inch) {
    const value = parseNumberish(inch[1]);
    return value !== null && Number.isFinite(value) ? value : null;
  }

  const bare = parseNumberish(s);
  if (bare === null) return null;
  const inches = units.system === 'metric' ? bare / MM_PER_INCH : bare;
  return Number.isFinite(inches) ? inches : null;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Format a length in inches for display. */
export function formatLength(inches: number, units: UnitSettings = defaultUnits): string {
  if (units.system === 'metric') {
    const mm = inches * MM_PER_INCH;
    if (Math.abs(mm) >= 1000 && units.mmDecimals === 0) return `${trim(mm / 1000, 3)} m`;
    return `${trim(mm, units.mmDecimals)} mm`;
  }
  const sign = inches < 0 ? '-' : '';
  const den = units.fraction;
  let n = Math.round(Math.abs(inches) * den);
  const approx = Math.abs(n / den - Math.abs(inches)) > 1e-4 ? '~ ' : '';
  const ft = Math.floor(n / (12 * den));
  n -= ft * 12 * den;
  const whole = Math.floor(n / den);
  let num = n - whole * den;
  let d = den;
  if (num) {
    const g = gcd(num, d);
    num /= g;
    d /= g;
  }
  const inchStr = num ? (whole ? `${whole} ${num}/${d}` : `${num}/${d}`) : `${whole}`;
  if (ft) return `${approx}${sign}${ft}' ${inchStr}"`;
  return `${approx}${sign}${inchStr}"`;
}

function trim(v: number, decimals: number): string {
  return parseFloat(v.toFixed(decimals)).toString();
}

/** Format an area given in square inches. */
export function formatArea(sqIn: number, units: UnitSettings = defaultUnits): string {
  if (units.system === 'metric') {
    const mm2 = sqIn * MM_PER_INCH * MM_PER_INCH;
    if (mm2 > 1e5) return `${trim(mm2 / 1e6, 3)} m²`;
    return `${trim(mm2, 0)} mm²`;
  }
  if (sqIn >= 144) return `${trim(sqIn / 144, 2)} ft²`;
  return `${trim(sqIn, 2)} in²`;
}

/**
 * Parse a list typed in the measurements box: "24, 48" or "24;48" or "2'x4'".
 * Returns null if any item fails to parse.
 */
export function parseLengthList(text: string, units: UnitSettings = defaultUnits): number[] | null {
  if (!text.trim()) return null;
  const parts = text.split(/[,;]|\s+x\s+|(?<=['"\d])x(?=[\d.-])/i).map((p) => p.trim());
  // Empty entries are invalid: silently ignoring one can create the wrong geometry.
  if (parts.some((p) => !p)) return null;
  const out: number[] = [];
  for (const p of parts) {
    const v = parseLength(p, units);
    if (v === null || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}
