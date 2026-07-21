import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { PriceSnapshotService } from './price-snapshot.service';

@Module({
  providers: [PricingService, PriceSnapshotService],
  controllers: [PricingController],
  exports: [PricingService, PriceSnapshotService],
})
export class PricingModule {}
