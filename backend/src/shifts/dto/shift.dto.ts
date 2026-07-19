import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class OpenShiftDto {
  @IsUUID()
  branch_id: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  opening_cash?: number;
}

export class CloseShiftDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  closing_cash: number;
}
