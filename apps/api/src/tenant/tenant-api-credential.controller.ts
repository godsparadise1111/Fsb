import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsArray, IsIn, IsISO8601, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequiresFeature } from '../auth/decorators/requires-feature.decorator';
import { TenantApiCredentialService } from './tenant-api-credential.service';
import { TenantReportsService } from './tenant-reports.service';

class CreateApiCredentialDto {
  @IsString() @Length(3,100) name: string;
  @IsArray() @IsIn(['tenant.read','reports.read'], { each: true }) scopes: string[];
  @IsOptional() @IsISO8601() expiresAt?: string;
}

@Controller('tenant/api-credentials')
@RequiresFeature('api_access')
export class TenantApiCredentialController {
  constructor(private readonly credentials: TenantApiCredentialService) {}

  @RequirePermissions('tenant.api.manage')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.credentials.list(user.tenantId);
  }

  @RequirePermissions('tenant.api.manage')
  @Post()
  issue(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateApiCredentialDto) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.credentials.issue(user.tenantId, user.sub, dto.name, dto.scopes, dto.expiresAt);
  }

  @RequirePermissions('tenant.api.manage')
  @Delete(':id')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    if (!user.tenantId) throw new BadRequestException('Tenant context is required');
    return this.credentials.revoke(user.tenantId, id, user.sub);
  }
}

@Controller('v1/tenant')
export class VersionedTenantPublicApiController {
  constructor(private readonly credentials: TenantApiCredentialService) {}

  @Public()
  @Get('profile')
  async profile(@Headers('x-fsb-api-key') apiKey?: string) {
    const authenticated = await this.credentials.authenticate(apiKey ?? '', 'tenant.read');
    return {
      apiVersion: 'v1',
      tenant: {
        id: authenticated.tenant.id,
        name: authenticated.tenant.name,
        code: authenticated.tenant.code,
        status: authenticated.tenant.status,
        plan: authenticated.tenant.plan,
      },
      scopes: authenticated.scopes,
    };
  }

  @Public()
  @Get('reports/overview')
  async reportOverview(
    @Headers('x-fsb-api-key') apiKey?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const authenticated = await this.credentials.authenticate(apiKey ?? '', 'reports.read');
    return {
      apiVersion: 'v1',
      report: await this.reports.overview(authenticated.tenant.id, { from, to }),
    };
  }
}
