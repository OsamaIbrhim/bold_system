import {
  decimal,
  lineMoney,
  moneyString,
  sameMoney,
  sumMoney,
} from './money';

describe('money arithmetic', () => {
  it('does not inherit JavaScript floating-point addition errors', () => {
    expect(sumMoney(['0.10', '0.20']).toFixed(2)).toBe('0.30');
  });

  it('uses one ROUND_HALF_UP policy at the money boundary', () => {
    expect(moneyString('1.005')).toBe('1.01');
    expect(moneyString('-1.005')).toBe('-1.01');
  });

  it('multiplies before rounding a line total', () => {
    expect(lineMoney('10.333333', 3).toFixed(2)).toBe('31.00');
  });

  it('compares canonical cents rather than binary numbers', () => {
    expect(sameMoney('12.300', 12.3)).toBe(true);
    expect(decimal('0.1').plus('0.2').equals('0.3')).toBe(true);
  });
});
