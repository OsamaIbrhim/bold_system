import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateSaleItemDto {
  @IsUUID()
  variant_id: string;

  @IsInt()
  @Min(1)
  qty: number;

  // Optional only for replaying pre-Phase-5A outbox rows. New POS sales always
  // provide the complete signed snapshot; mixed legacy/signed carts are rejected.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  unit_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unit_tax?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  price_version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  price_token?: string;
}

export class CreateSaleDto {
  @IsUUID()
  sync_id: string;

  @IsUUID()
  branch_id: string;

  @IsUUID()
  shift_id: string;

  @IsUUID()
  origin_cashier_id: string;

  @IsUUID()
  seller_id: string;

  @IsUUID()
  offline_session_id: string;

  @IsString()
  @Matches(/^[1-9]\d{0,18}$/, {
    message: 'terminal_sequence must be a positive decimal integer',
  })
  terminal_sequence: string;

  @IsDateString()
  occurred_at: string;

  @IsString()
  @MaxLength(4096)
  offline_accounting_token: string;

  @IsOptional()
  @Matches(/^(?:\+20|0)1[0125]\d{8}$/, {
    message: 'customer_phone must be a valid Egyptian mobile number',
  })
  customer_phone?: string;

  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  @ArrayMinSize(1)
  items: CreateSaleItemDto[];

  @IsString()
  @IsIn(['cash', 'card', 'instapay', 'vodafone_cash', 'installment'])
  payment_method: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  local_total?: number;
}
