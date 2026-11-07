import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from '../organization/entities/organization.entity';
import { User } from '../identity/entities/user.entity';
import { ProcessInstance } from '../workflow/entities/process-instance.entity';
import { FormDefinition } from './entities/form-definition.entity';
import { FormVersion } from './entities/form-version.entity';
import { FormSubmission } from './entities/form-submission.entity';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, User, ProcessInstance, FormDefinition, FormVersion, FormSubmission])],
  controllers: [FormsController],
  providers: [FormsService],
})
export class FormsModule {}