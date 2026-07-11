import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
@Controller('products')
export class ProductsController {
  constructor(private svc: ProductsService) {}
  @Get('search')
  search(@Query('q') q: string, @Query('branch_id') branch_id?: string) { return this.svc.search(q || '', branch_id); }
  @Post()
  create(@Body() dto: any) { return this.svc.createProduct(dto); }
}
