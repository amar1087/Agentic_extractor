// src/lib/money.ts
// PURPOSE: The only place amounts cross the number ↔ integer-cents boundary (NFR-03).

import { Decimal } from "decimal.js";

export function toCents(amount: number | string): number {
  return new Decimal(amount).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function fromCents(cents: number): string {
  return new Decimal(cents).dividedBy(100).toFixed(2);
}

export function formatMoney(cents: number, currency = "USD"): string {
  const value = new Decimal(cents).dividedBy(100).toNumber();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${fromCents(cents)}`;
  }
}
