import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../../identity/entities/user-role.entity';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @InjectRepository(UserRole) private readonly assignments: Repository<UserRole>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;
    if (!userId) throw new ForbiddenException('Authenticated user context is missing');

    const organizationId = request.params?.organizationId ?? request.body?.organizationId ?? request.query?.organizationId ?? null;
    const grants = await this.assignments.find({
      where: { userId, isActive: true },
      relations: { role: { permissions: true } },
    });
    const grantedCodes = new Set<string>();\n    let platformWildcard = false;
    for (const assignment of grants) {
      if (!assignment.role?.isActive) continue;
      if (assignment.role.scope === 'PLATFORM') {
        for (const permission of assignment.role.permissions ?? []) {\n          if (permission.code === '*') platformWildcard = true;\n          else grantedCodes.add(permission.code);\n        }
        continue;
      }
      // Organization roles must always be evaluated against an explicit organization context.
      if (!organizationId || assignment.organizationId !== organizationId) continue;
      // A wildcard attached to an organization role must never become a platform-wide bypass.\n      for (const permission of assignment.role.permissions ?? []) if (permission.code !== '*') grantedCodes.add(permission.code);
    }

    if (platformWildcard || required.every(code => grantedCodes.has(code))) return true;
    throw new ForbiddenException('Insufficient permissions');
  }
}
