import { TransfersController } from './transfers.controller';

describe('TransfersController command forwarding', () => {
  const actor = {
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'warehouse_manager' as const,
    branch_id: '22222222-2222-4222-8222-222222222222',
  };
  const request = { user: actor } as any;

  function setup() {
    const service = {
      ship: jest.fn().mockResolvedValue({ id: 'transfer-1' }),
      receive: jest.fn().mockResolvedValue({ id: 'transfer-1' }),
    };
    return {
      service,
      controller: new TransfersController(service as any),
    };
  }

  it('keeps legacy empty-body ship requests compatible with the command DTO', async () => {
    const { controller, service } = setup();

    await controller.ship(
      'transfer-1',
      undefined as any,
      request,
    );

    expect(service.ship).toHaveBeenCalledWith(
      'transfer-1',
      {},
      actor,
    );
  });

  it('keeps legacy empty-body receive requests as full receipts', async () => {
    const { controller, service } = setup();

    await controller.receive(
      'transfer-1',
      undefined as any,
      request,
    );

    expect(service.receive).toHaveBeenCalledWith(
      'transfer-1',
      {},
      actor,
    );
  });
});
