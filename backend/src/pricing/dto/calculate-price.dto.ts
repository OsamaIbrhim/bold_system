import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CalculatePriceDto {
  @IsUUID()
  variant_id: string;

  // BR-PSL-104: the qualifying quantity for quantity-break resolution.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty = 1;
}
