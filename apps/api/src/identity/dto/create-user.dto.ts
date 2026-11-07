import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
export class CreateUserDto {
  @IsString() @Length(1, 120) firstName: string;
  @IsString() @Length(1, 120) lastName: string;
  @IsEmail() @MaxLength(190) email: string;
  @IsString() @Length(3, 80) @Matches(/^[a-zA-Z0-9._-]+$/) username: string;
  @IsString() @Length(10, 128) password: string;
  @IsOptional() @IsString() @Length(7, 40) phone?: string;
}