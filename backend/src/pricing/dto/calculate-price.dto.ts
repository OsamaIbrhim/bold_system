import { IsUUID } from 'class-validator';

export class CalculatePriceDto {
  @IsUUID()
  variant_id: string;
}
