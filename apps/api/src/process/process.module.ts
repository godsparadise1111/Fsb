import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { ProcessDefinition } from './entities/process-definition.entity';
import { ProcessVersion } from './entities/process-version.entity';
import { ProcessController } from './process.controller';
import { ProcessService } from './process.service';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, ProcessDefinition, ProcessVersion]), TenantModule],
  controllers: [ProcessController],
  providers: [ProcessService],
})
export class ProcessModule {}