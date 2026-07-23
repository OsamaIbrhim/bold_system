import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('financial precision contract', () => {
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8');

  it('keeps report aggregation on Decimal arithmetic', () => {
    const reports = source('src/reports/reports.service.ts');

    expect(reports).toContain('sumMoney(');
    expect(reports).toContain('lineMoney(');
    expect(reports).not.toMatch(/\bMath\.round\s*\(/);
    expect(reports).not.toMatch(/\bNumber\s*\(\s*(?:invoice|item|record|row)\./);
  });

  it('keeps sale and return reconciliation off binary cent comparisons', () => {
    const sales = source('src/sales/sales.service.ts');

    expect(sales).toContain('sameMoney(dto.local_total, total)');
    expect(sales).not.toMatch(/Math\.round\s*\(\s*dto\.local_total\s*\*\s*100/);
    expect(sales).not.toContain('Number(variant.cost_price)');
    expect(sales).not.toContain('Number(soldItem.unit_price)');
    expect(sales).not.toContain('Number(soldItem.unit_cost)');
    expect(sales).not.toContain('Number(soldItem.unit_tax)');
  });

  it('keeps POS totals in integer cents', () => {
    const main = source('../pos-electron/electron/main.ts');
    const utils = source('../pos-electron/src/utils.ts');
    const register = source(
      '../pos-electron/src/screens/RegisterScreen.tsx',
    );

    expect(main).toContain('lineCents(item.unit_price, item.qty)');
    expect(main).toContain('sameMoney(localTotal');
    expect(main).not.toMatch(/Math\.round\s*\(\s*localTotal\s*\*\s*100/);
    expect(utils).not.toMatch(/\*\s*100/);
    expect(register).not.toContain('item.unit_price*item.qty');
  });

  it('does not recompute invoice money with floats in Admin', () => {
    const invoicePage = source(
      '../admin-web/app/sales/[id]/page.tsx',
    );

    expect(invoicePage).toContain('lineTotal(i.unit_price,i.unit_tax,i.qty)');
    expect(invoicePage).not.toMatch(
      /Number\(i\.unit_price\)\s*\*\s*i\.qty/,
    );
  });
});
