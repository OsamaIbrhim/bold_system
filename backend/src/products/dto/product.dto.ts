import { IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

class VariantFieldsDto {
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

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost_price?: number;
}

export class CreateProductDto extends VariantFieldsDto {
  @IsString()
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
  @MaxLength(100)
  sku: string;
}

export class UpdateVariantDto extends VariantFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;
}
