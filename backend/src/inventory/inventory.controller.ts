import { Controller, Get, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
@Controller('inventory')
export class InventoryController {
  constructor(private svc: InventoryService) {}
  @Get('lookup')
  lookup(@Query('variant_id') variant_id: string) { return this.svc.lookup(variant_id); }
}
