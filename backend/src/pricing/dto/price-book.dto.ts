import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PriceBookScope, PriceBookStatus } from '@prisma/client';

const SCOPE_VALUES = Object.values(PriceBookScope);
const STATUS_VALUES = Object.values(PriceBookStatus);

export class CreatePriceBookDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  // BR-PRB-100/OD-CAT-005: optional — defaults to the tenant's operating
  // currency; supplying a different value is rejected (single-currency MVP).
  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsIn(SCOPE_VALUES)
  scope?: PriceBookScope;

  @IsOptional()
  @IsUUID()
  scope_ref_id?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class UpdatePriceBookDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
}

export class SchedulePriceBookDto {
  @IsOptional()
  @IsDateString()
  effective_from?: string;
}

export class ListPriceBooksDto {
  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: PriceBookStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 20;
}
