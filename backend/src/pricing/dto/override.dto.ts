import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class ApplyOverrideDto {
  @IsUUID()
  variant_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty = 1;

  // BR-PSL-103: negative rejected in the service layer (pricing-specific code).
  @IsNumber({ maxDecimalPlaces: 2 })
  override_price: number;

  // BR-OVP-100: an override is never applied without a recorded reason.
  @IsString()
  @MinLength(1)
  reason: string;

  // Opaque caller reference (e.g. a sale/line id) — see PriceOverride's schema comment.
  @IsOptional()
  @IsString()
  reference?: string;
}

export class PriceOverridePolicyDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  max_discount_percent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  max_discount_amount?: number;

  @IsOptional()
  @IsBoolean()
  allow_price_increase?: boolean;
}
