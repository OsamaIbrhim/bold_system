import { preparePurchaseReceipt } from './purchasing-accounting';

describe('purchase accounting preparation', () => {
  const base = {
    command_id: '99999999-9999-4999-8999-999999999999',
    supplier_id: '11111111-1111-4111-8111-111111111111',
    branch_id: '22222222-2222-4222-8222-222222222222',
    items: [],
  } as any;

  it('allocates a cent-level discount exactly and deterministically', () => {
    const prepared = preparePurchaseReceipt({
      ...base,
      discount_amount: 0.01,
      items: [
        {
          variant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          qty: 1,
          unit_cost: 1,
        },
        {
          variant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          qty: 1,
          unit_cost: 1,
        },
        {
          variant_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          qty: 1,
          unit_cost: 1,
        },
      ],
    });

    expect(prepared.discount.toFixed(2)).toBe('0.01');
    expect(
      prepared.lines
        .map((line) => line.allocated_discount.toFixed(2)),
    ).toEqual(['0.01', '0.00', '0.00']);
    expect(
      prepared.lines
        .reduce(
          (sum, line) => sum.plus(line.net_line_total),
          prepared.total.minus(prepared.total),
        )
        .toFixed(2),
    ).toBe(prepared.total.toFixed(2));
  });

  it('aggregates duplicate variants without losing gross line value', () => {
    const prepared = preparePurchaseReceipt({
      ...base,
      items: [
        {
          variant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          qty: 2,
          unit_cost: 10,
        },
        {
          variant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          qty: 1,
          unit_cost: 11,
        },
      ],
    });

    expect(prepared.lines).toHaveLength(1);
    expect(prepared.lines[0].qty).toBe(3);
    expect(prepared.lines[0].line_subtotal.toFixed(2)).toBe('31.00');
    expect(prepared.lines[0].unit_cost.toFixed(6)).toBe('10.333333');
  });

  it('normalizes supplier invoice identity and fingerprints canonical data', () => {
    const first = preparePurchaseReceipt({
      ...base,
      command_id: '33333333-3333-4333-8333-333333333333',
      invoice_number: '  inv   42 ',
      items: [
        {
          variant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          qty: 1,
          unit_cost: 100,
        },
      ],
    });
    const second = preparePurchaseReceipt({
      ...base,
      command_id: '33333333-3333-4333-8333-333333333333',
      invoice_number: 'INV 42',
      items: [
        {
          variant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          qty: 1,
          unit_cost: 100,
        },
      ],
    });

    expect(first.normalizedInvoiceNumber).toBe('INV 42');
    expect(first.idempotencyKey).toBe(
      'purchase-command:33333333-3333-4333-8333-333333333333',
    );
    expect(first.commandFingerprint).toBe(second.commandFingerprint);
  });


  it('requires an explicit command id when the supplier invoice has no number', () => {
    expect(() =>
      preparePurchaseReceipt({
        ...base,
        command_id: undefined,
        items: [
          {
            variant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            qty: 1,
            unit_cost: 100,
          },
        ],
      }),
    ).toThrow(
      'command_id is required when supplier invoice number is unavailable',
    );
  });

});
