import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateSaleItemDto {
  @IsUUID()
  variant_id: string;

  @IsInt()
  @Min(1)
  qty: number;
}

export class CreateSaleDto {
  @IsOptional()
  @IsUUID()
  sync_id?: string;

  @IsUUID()
  branch_id: string;

  @IsOptional()
  @Matches(/^(?:\+20|0)1[0125]\d{8}$/, { message: 'customer_phone must be a valid Egyptian mobile number' })
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
}
