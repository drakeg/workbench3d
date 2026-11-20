/** Deterministic, local-only cut-list costing. Prices are user-entered per whole stock sheet/board. */
export interface PricedStock {
  key: string;
  label: string;
  count: number;
  /** Price per complete sheet or board; null means not quoted. */
  unitPrice: number | null;
  /** Number of parts that couldn't be placed on the selected stock size. */
  unplaced: number;
}

export interface CostLine extends PricedStock {
  extended: number | null;
}
export interface CostEstimate {
  lines: CostLine[];
  /** Sum of priced lines only; never a misleading grand total when quotes are missing. */
  quotedSubtotal: number;
  grandTotal: number | null;
  missingQuotes: number;
  unplacedParts: number;
}

/** Reject negative, non-finite, malformed and fractional-cent prices. Blank means unknown, not free. */
export function parseStockPrice(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(Math.round(amount * 100)) && amount <= Number.MAX_SAFE_INTEGER / 100 ? amount : null;
}

export function estimateStockCost(stocks: readonly PricedStock[]): CostEstimate {
  let cents = 0;
  let missingQuotes = 0;
  let unplacedParts = 0;
  const lines = stocks.map((stock): CostLine => {
    if (!Number.isSafeInteger(stock.count) || stock.count < 0 || !Number.isSafeInteger(stock.unplaced) || stock.unplaced < 0) {
      throw new Error('Invalid stock counts');
    }
    const price = stock.unitPrice;
    if (price !== null && (price < 0 || !Number.isFinite(price) || Math.abs(Math.round(price * 100) - price * 100) > 1e-7)) {
      throw new Error('Invalid stock price');
    }
    const totalCents = price === null ? null : Math.round(price * 100) * stock.count;
    if (totalCents !== null && !Number.isSafeInteger(totalCents)) throw new Error('Stock cost overflow');
    if (totalCents === null) missingQuotes++;
    else cents += totalCents;
    if (!Number.isSafeInteger(cents)) throw new Error('Cost estimate overflow');
    unplacedParts += stock.unplaced;
    return { ...stock, extended: totalCents === null ? null : totalCents / 100 };
  });
  return { lines, quotedSubtotal: cents / 100, grandTotal: missingQuotes === 0 && unplacedParts === 0 ? cents / 100 : null, missingQuotes, unplacedParts };
}

export const money = (amount: number | null): string => (amount === null ? 'Not quoted' : '$' + amount.toFixed(2));
