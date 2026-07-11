import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SalesModule } from '../sales/sales.module';
@Module({ imports: [SalesModule], providers: [SyncService], controllers: [SyncController] })
export class SyncModule {}
