import { Type } from 'class-transformer'
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class ListReturnsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q = ''

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 20

  @IsOptional()
  @IsUUID()
  branch_id?: string
}