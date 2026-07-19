import { IsIn } from 'class-validator';

export class ReviewOfferDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';
}
