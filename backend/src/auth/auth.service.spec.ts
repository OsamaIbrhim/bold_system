import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService refresh rotation', () => {
  const user = {
    id: 'user-1',
    branch_id: 'branch-1',
    name: 'Cashier',
    phone: '+201000000000',
    email: null,
    password_hash: 'hash',
    role: 'cashier' as const,
    is_active: true,
    created_at: new Date(),
  };

  function setup(revokedCount = 1) {
    const tx = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'old-token', user, revoked_at: null, expires_at: new Date(Date.now() + 60000),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: revokedCount }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      refreshToken: { create: jest.fn(), updateMany: jest.fn() },
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
    return { service: new AuthService(prisma as any, jwt as any), tx, jwt };
  }

  it('revokes the presented token and returns a newly stored opaque token', async () => {
    const { service, tx, jwt } = setup();
    const result = await service.refresh('old-refresh-token');
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-token', revoked_at: null },
    }));
    expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(result.refresh_token).not.toBe('old-refresh-token');
    expect(result.access_token).toBe('access-token');
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sub: user.id, branch_id: user.branch_id }));
  });

  it('rejects concurrent reuse after another request has claimed the token', async () => {
    const { service } = setup(0);
    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
