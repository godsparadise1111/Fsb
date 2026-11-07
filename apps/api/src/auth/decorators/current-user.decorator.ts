import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export interface AuthenticatedUser {
  sub: string;
  username: string;
  email: string;
  tenantId?: string | null;
  tenantMembershipId?: string | null;
  isTenantAdmin?: boolean;
}
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  return context.switchToHttp().getRequest().user;
});
