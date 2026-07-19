import { Module } from '@nestjs/common';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { PricingModule } from '../pricing/pricing.module';
@Module({ imports: [PricingModule], providers: [OffersService], controllers: [OffersController] })
export class OffersModule {}
