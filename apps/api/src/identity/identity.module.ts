import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserPosition } from './entities/user-position.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { UserRole } from './entities/user-role.entity';
import { Position } from '../organization/entities/position.entity';
import { Organization } from '../organization/entities/organization.entity';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserPosition, Role, Permission, UserRole, Position, Organization])],
  controllers: [IdentityController],
  providers: [IdentityService],
})
export class IdentityModule {}