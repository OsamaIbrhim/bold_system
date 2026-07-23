import { commandFingerprint } from './transfer-command';

describe('transfer command fingerprint', () => {
  it('is stable across object key order', () => {
    expect(commandFingerprint({ b: 2, a: 1 })).toBe(
      commandFingerprint({ a: 1, b: 2 }),
    );
  });

  it('changes when receipt quantities change', () => {
    expect(
      commandFingerprint({ item: 'x', received_qty: 1 }),
    ).not.toBe(
      commandFingerprint({ item: 'x', received_qty: 2 }),
    );
  });
});
