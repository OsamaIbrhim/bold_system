import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CAPABILITIES, Capability } from './permissions';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export const CAPABILITIES_KEY = 'capabilities';
export const RequireCapabilities = (...capabilities: Capability[]) =>
  SetMetadata(CAPABILITIES_KEY, capabilities);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const capabilities = this.reflector.getAllAndOverride<Capability[]>(
      CAPABILITIES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (
      capabilities &&
      capabilities.every((capability) => CAPABILITIES.includes(capability))
    ) {
      const effective = new Set(req.user?.capabilities || []);
      return capabilities.every((capability) => effective.has(capability));
    }
    if (!required) return true;
    return required.includes(req.user?.role);
  }
}
