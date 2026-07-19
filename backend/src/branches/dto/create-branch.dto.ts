import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{2,30}$/)
  code: string;

  @IsString()
  @MaxLength(150)
  name_ar: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name_en?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  cash_drawer_enabled?: boolean;
}
