import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../identity/entities/user.entity';
import { Role } from '../identity/entities/role.entity';
import { Permission } from '../identity/entities/permission.entity';
import { UserRole } from '../identity/entities/user-role.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, Permission, UserRole]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'development-only-change-this-secret', signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' } }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}