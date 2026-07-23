import { Prisma } from '@prisma/client';

export type MoneyInput = Prisma.Decimal | number | string;

export const MONEY_SCALE = 2;
export const MONEY_ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

export function decimal(value: MoneyInput): Prisma.Decimal {
  const result = new Prisma.Decimal(value);
  if (!result.isFinite()) throw new TypeError('Money value must be finite');
  return result;
}

export function money(value: MoneyInput): Prisma.Decimal {
  return decimal(value).toDecimalPlaces(MONEY_SCALE, MONEY_ROUNDING);
}

export function moneyString(value: MoneyInput): string {
  return money(value).toFixed(MONEY_SCALE);
}

/**
 * Use only at an existing JSON/API boundary that still exposes monetary
 * values as numbers. All arithmetic must happen before this conversion.
 */
export function moneyNumber(value: MoneyInput): number {
  return Number(moneyString(value));
}

export function sameMoney(left: MoneyInput, right: MoneyInput): boolean {
  return money(left).equals(money(right));
}

export function sumMoney(values: Iterable<MoneyInput>): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const value of values) total = total.plus(decimal(value));
  return money(total);
}

export function lineMoney(unit: MoneyInput, quantity: number): Prisma.Decimal {
  if (!Number.isSafeInteger(quantity)) {
    throw new TypeError('Money quantity must be a safe integer');
  }
  return money(decimal(unit).mul(quantity));
}
