import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module';
import { OrganizationModule } from './organization/organization.module';
import { IdentityModule } from './identity/identity.module';
import { ProcessModule } from './process/process.module';
import { Organization } from './organization/entities/organization.entity';
import { OrganizationUnit } from './organization/entities/organization-unit.entity';
import { Position } from './organization/entities/position.entity';
import { User } from './identity/entities/user.entity';
import { UserPosition } from './identity/entities/user-position.entity';
import { Role } from './identity/entities/role.entity';
import { Permission } from './identity/entities/permission.entity';
import { UserRole } from './identity/entities/user-role.entity';
import { ProcessDefinition } from './process/entities/process-definition.entity';
import { ProcessVersion } from './process/entities/process-version.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.POSTGRES_USER ?? 'fsb',
      password: process.env.POSTGRES_PASSWORD ?? 'change_me_locally',
      database: process.env.POSTGRES_DB ?? 'fsb',
      entities: [Organization, OrganizationUnit, Position, User, UserPosition, Role, Permission, UserRole, ProcessDefinition, ProcessVersion],
      synchronize: process.env.DB_SYNCHRONIZE === 'true',
      autoLoadEntities: true,
    }),
    HealthModule,
    OrganizationModule,
    IdentityModule,
    ProcessModule,
  ],
})
export class AppModule {}
