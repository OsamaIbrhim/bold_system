import { Prisma } from '@prisma/client';
import { calculateSupplierReturnCredit } from './purchasing-accounting';

describe('supplier return credit accounting', () => {
  it('uses the exact remaining line credit on the final partial return', () => {
    const first = calculateSupplierReturnCredit({
      lineQty: 3,
      lineCreditTotal: 100,
      returnedQty: 0,
      returnedCredit: 0,
      requestedQty: 1,
      defaultUnitCredit: new Prisma.Decimal(100).div(3),
    });
    const final = calculateSupplierReturnCredit({
      lineQty: 3,
      lineCreditTotal: 100,
      returnedQty: 1,
      returnedCredit: first.creditTotal,
      requestedQty: 2,
      defaultUnitCredit: new Prisma.Decimal(100).div(3),
    });

    expect(first.creditTotal.toFixed(2)).toBe('33.33');
    expect(final.creditTotal.toFixed(2)).toBe('66.67');
    expect(
      first.creditTotal.plus(final.creditTotal).toFixed(2),
    ).toBe('100.00');
  });

  it('rejects returning more than the unreturned purchase quantity', () => {
    expect(() =>
      calculateSupplierReturnCredit({
        lineQty: 3,
        lineCreditTotal: 100,
        returnedQty: 2,
        returnedCredit: 66.67,
        requestedQty: 2,
        defaultUnitCredit: 33.333333,
      }),
    ).toThrow('Only 1 unit(s) remain returnable');
  });
});
