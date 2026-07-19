import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SalesModule } from '../sales/sales.module';
import { PricingModule } from '../pricing/pricing.module';
@Module({ imports: [SalesModule, PricingModule], providers: [SyncService], controllers: [SyncController] })
export class SyncModule {}
