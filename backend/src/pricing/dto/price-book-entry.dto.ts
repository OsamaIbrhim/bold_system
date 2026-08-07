import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { PriceEntryScopeType } from '@prisma/client';

const SCOPE_TYPE_VALUES = Object.values(PriceEntryScopeType);

export class CreatePriceEntryDto {
  @IsUUID()
  price_book_id: string;

  @IsIn(SCOPE_TYPE_VALUES)
  scope_type: PriceEntryScopeType;

  // Required unless scope_type is "global" — checked in PriceBookService,
  // not here, since the rule spans two fields.
  @ValidateIf((dto: CreatePriceEntryDto) => dto.scope_type !== 'global')
  @IsUUID()
  scope_id?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  min_qty?: number;

  // BR-PSL-103: negative is rejected in the service layer, not here, so the
  // error carries the pricing-specific code instead of a generic 400.
  @IsNumber({ maxDecimalPlaces: 2 })
  unit_price: number;

  @IsOptional()
  @IsBoolean()
  allow_zero_price?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax_percent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  floor_price?: number;
}

export class SupersedePriceEntryDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  unit_price: number;

  @IsOptional()
  @IsBoolean()
  allow_zero_price?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax_percent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  floor_price?: number;
}
