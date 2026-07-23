import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TransferItemDto {
  @IsUUID()
  variant_id: string;

  @IsInt()
  @Min(1)
  qty: number;
}

export class CreateTransferDto {
  @IsUUID()
  from_branch_id: string;

  @IsUUID()
  to_branch_id: string;

  @IsOptional()
  @IsUUID()
  command_id?: string;

  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  @ArrayMinSize(1)
  items: TransferItemDto[];
}

export class TransferCommandDto {
  @IsOptional()
  @IsUUID()
  command_id?: string;
}

export class CancelTransferDto extends TransferCommandDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ReceiveTransferItemDto {
  @IsUUID()
  transfer_item_id: string;

  @IsInt()
  @Min(0)
  received_qty: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  damaged_qty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  missing_qty?: number;
}

export class ReceiveTransferDto extends TransferCommandDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferItemDto)
  items?: ReceiveTransferItemDto[];
}
