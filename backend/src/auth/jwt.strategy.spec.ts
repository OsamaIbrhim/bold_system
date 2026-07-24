import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy authorization recheck cache', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
  });

  it('coalesces concurrent database rechecks and briefly caches the result', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({
      id: 'user-1', role: 'owner', branch_id: null, is_active: true,
    }) } };
    const strategy = new JwtStrategy(prisma as any);
    const [first, second] = await Promise.all([
      strategy.validate({ sub: 'user-1' }),
      strategy.validate({ sub: 'user-1' }),
    ]);
    const third = await strategy.validate({ sub: 'user-1' });
    expect(first).toEqual(expect.objectContaining({
      sub: 'user-1',
      role: 'owner',
      branch_id: null,
      capabilities: expect.arrayContaining(['users.manage']),
    }));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
