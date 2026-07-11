import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
export const Roles = (...roles: string[]) => (target: any, key?: any, descriptor?: any) => {
  Reflect.defineMetadata('roles', roles, descriptor?.value || target); return descriptor;
};
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const required = Reflect.getMetadata('roles', ctx.getHandler());
    if (!required) return true;
    return required.includes(req.user?.role);
  }
}
