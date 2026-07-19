import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

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
