import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

export const EGYPTIAN_MOBILE_PATTERN = /^(?:\+20|0)1[0125]\d{8}$/;

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @Transform(({ value }) => typeof value === 'string' ? value.replace(/\s+/g, '') : value)
  @IsString()
  @Matches(EGYPTIAN_MOBILE_PATTERN, { message: 'phone must be a valid Egyptian mobile number' })
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsUUID()
  branch_id?: string;
}
