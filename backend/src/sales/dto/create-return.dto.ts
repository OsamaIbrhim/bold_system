import { Type } from 'class-transformer';
import { ArrayMinSize, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateReturnItemDto {
  @IsUUID()
  sales_invoice_item_id: string;

  @IsInt()
  @Min(1)
  qty: number;
}

export class CreateReturnDto {
  @IsUUID()
  original_invoice_id: string;

  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  @ArrayMinSize(1)
  items: CreateReturnItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
