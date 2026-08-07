import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { DiscountBasis } from '@prisma/client';

const BASIS_VALUES = Object.values(DiscountBasis);

export class ApplyDiscountDto {
  @IsUUID()
  variant_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty = 1;

  @IsIn(BASIS_VALUES)
  basis: DiscountBasis;

  // Percentage (0-100) or a fixed money amount, per `basis`.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  reference?: string;
}
