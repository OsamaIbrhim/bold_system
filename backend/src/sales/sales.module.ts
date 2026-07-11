import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { PricingModule } from '../pricing/pricing.module';
import { InvoicePdfService } from './invoice-pdf.service';
@Module({ imports: [PricingModule], providers: [SalesService, InvoicePdfService], controllers: [SalesController], exports: [SalesService] })
export class SalesModule {}
