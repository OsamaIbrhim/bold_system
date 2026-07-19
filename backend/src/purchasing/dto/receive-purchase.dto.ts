import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReceivePurchaseItemDto {
  @IsUUID()
  variant_id: string;

  @IsInt()
  @Min(1)
  qty: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unit_cost: number;
}

export class ReceivePurchaseDto {
  @IsUUID()
  supplier_id: string;

  @IsUUID()
  branch_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoice_number?: string;

  @IsOptional()
  @IsDateString()
  invoice_date?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount_amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discount_percent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ocr_source_file?: string;

  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseItemDto)
  @ArrayMinSize(1)
  items: ReceivePurchaseItemDto[];
}

export class OcrImportDto {
  @IsString()
  @MaxLength(2048)
  fileUrl: string;
}
