import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ProductsService } from './products.service';
import { Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import { CreateProductDto, UpdateVariantDto } from './dto/product.dto';
@Controller('products')
export class ProductsController {
  constructor(private svc: ProductsService) {}
  @Get('search')
  search(
    @Query('q') q: string,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const canReadCost = ['owner', 'branch_manager', 'warehouse_manager'].includes(req.user.role);
    const effectiveBranch = resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']);
    return this.svc.search(q || '', effectiveBranch, canReadCost);
  }
  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @Post()
  create(@Body() dto: CreateProductDto) { return this.svc.createProduct(dto); }
  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @Patch('variants/:id')
  updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto) { return this.svc.updateVariant(id, dto); }
  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @Delete('variants/:id')
  removeVariant(@Param('id') id: string) { return this.svc.removeVariant(id); }
}
