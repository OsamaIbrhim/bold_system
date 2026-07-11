import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
@Module({ providers: [ShiftsService], controllers: [ShiftsController] })
export class ShiftsModule {}
