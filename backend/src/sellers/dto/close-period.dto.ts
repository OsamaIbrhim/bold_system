import { IsDateString } from 'class-validator';

export class CloseSellerPeriodDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
