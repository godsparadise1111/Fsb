import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
export class StartProcessDto {
  @IsUUID() processVersionId: string;
  @IsUUID() organizationId: string;
  @IsString() @Length(2, 240) title: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) initialAssigneeUserIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) initialAssigneePositionIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) initialAssigneeUnitIds?: string[];
  @IsOptional() @IsString() @Matches(/^(ANY_ASSIGNEE|ALL_ASSIGNEES)$/) assignmentPolicy?: 'ANY_ASSIGNEE' | 'ALL_ASSIGNEES';
  @IsOptional() @IsString() @MaxLength(200) firstTaskTitle?: string;
}
