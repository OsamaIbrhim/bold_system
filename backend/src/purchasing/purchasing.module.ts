import { Module } from '@nestjs/common';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';
@Module({ providers: [PurchasingService], controllers: [PurchasingController] })
export class PurchasingModule {}
