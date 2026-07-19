import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTerminalEnrollmentDto {
  @IsOptional()
  @IsUUID('4', { message: 'branch_id must be a valid branch identifier' })
  branch_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'name must contain at least 2 characters' })
  @MaxLength(80)
  name?: string;
}

export class EnrollTerminalDto {
  @IsString()
  @Length(12, 12, { message: 'enrollment_code must contain 12 characters' })
  enrollment_code: string;

  @IsUUID('4', { message: 'device_id must be a valid terminal identifier' })
  device_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  app_version?: string;
}

export class TerminalHeartbeatDto {
  @IsUUID()
  device_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  app_version?: string;

  @IsOptional()
  @IsIn(['never', 'syncing', 'success', 'error', 'offline'])
  sync_status?: string;

  @IsOptional()
  @IsDateString()
  last_sync_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  last_error?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  pending_count?: number;
}

export class UpdateTerminalDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  revoked?: boolean;
}
