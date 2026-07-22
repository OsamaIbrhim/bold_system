import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { TerminalsModule } from '../terminals/terminals.module';
import { OfflineAccountingTicketService } from './offline-accounting-ticket.service';

@Module({
  imports: [TerminalsModule],
  providers: [ShiftsService, OfflineAccountingTicketService],
  controllers: [ShiftsController],
  exports: [ShiftsService, OfflineAccountingTicketService],
})
export class ShiftsModule {}
