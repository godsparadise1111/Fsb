import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../identity/entities/user.entity';
import { Role } from '../identity/entities/role.entity';
import { Permission } from '../identity/entities/permission.entity';
import { UserRole } from '../identity/entities/user-role.entity';
import { Tenant } from '../tenant/entities/tenant.entity';
import { TenantMembership } from '../tenant/entities/tenant-membership.entity';
import { Organization } from '../organization/entities/organization.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';

const jwtSecret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'development-only-change-this-secret');
if (jwtSecret.length < 32) throw new Error('Configure JWT_SECRET with at least 32 characters before production startup.');

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, Permission, UserRole, Tenant, TenantMembership, Organization]), PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({ secret: jwtSecret, signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' } })],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard }],
  exports: [AuthService],
})
export class AuthModule {}