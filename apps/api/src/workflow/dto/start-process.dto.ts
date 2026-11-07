import { ArrayMinSize, IsArray, IsObject, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
export class StartProcessDto {
  @IsUUID() processVersionId: string;
  @IsUUID() organizationId: string;
  @IsUUID() startedByUserId: string;
  @IsString() @Length(2, 240) title: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) initialAssigneeUserIds: string[];
  @IsOptional() @IsString() @Matches(/^(ANY_ASSIGNEE|ALL_ASSIGNEES)$/) assignmentPolicy?: 'ANY_ASSIGNEE' | 'ALL_ASSIGNEES';
  @IsOptional() @IsString() firstTaskTitle?: string;
}