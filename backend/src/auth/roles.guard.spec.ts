import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  function context(role: string): ExecutionContext {
    return {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as any;
  }

  it('allows a required role', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['owner']) } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(context('owner'))).toBe(true);
    expect((reflector.getAllAndOverride as jest.Mock)).toHaveBeenCalledWith(
      ROLES_KEY,
      expect.any(Array),
    );
  });

  it('denies a role that is not allowed', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['owner']) } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(context('cashier'))).toBe(false);
  });
});
