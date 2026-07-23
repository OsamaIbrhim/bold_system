import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

class VariantIdentityFieldsDto {
  @IsOptional()
  @Matches(/^\d{13}$/)
  barcode_ean13?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode_internal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  style?: string;
}

export class CreateProductDto extends VariantIdentityFieldsDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2, {
    message: 'name_en must contain at least 2 characters',
  })
  @MaxLength(200)
  name_en: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsString()
  @MinLength(2, {
    message: 'sku must contain at least 2 characters',
  })
  @MaxLength(100)
  sku: string;

  // Initial cost is allowed only before the variant has stock. Every later
  // cost change is posted by the purchasing cost ledger.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  cost_price?: number;
}

export class UpdateVariantDto extends VariantIdentityFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;
}
