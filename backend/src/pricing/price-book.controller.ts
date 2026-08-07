import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PriceBookService } from './price-book.service';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  CreatePriceBookDto,
  ListPriceBooksDto,
  SchedulePriceBookDto,
  UpdatePriceBookDraftDto,
} from './dto/price-book.dto';
import { CreatePriceEntryDto, SupersedePriceEntryDto } from './dto/price-book-entry.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

/** WP-008 Phase B (BR-PRB-1xx, Permission Matrix §17): the Price Book maker-checker lifecycle. */
@Controller('pricing/price-books')
@RequireCapabilities('products.read')
export class PriceBookController {
  constructor(private readonly svc: PriceBookService) {}

  @RequirePermission('pricing.price-book.view')
  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query() dto: ListPriceBooksDto) {
    return this.svc.list(ctx, dto);
  }

  @RequirePermission('pricing.price-book.view')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.findOne(ctx, id);
  }

  @RequirePermission('pricing.price-book.create')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreatePriceBookDto, @Req() req: AuthedRequest) {
    return this.svc.create(ctx, req.user.sub, dto);
  }

  @RequirePermission('pricing.price-book.update-draft')
  @Patch(':id')
  updateDraft(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdatePriceBookDraftDto,
  ) {
    return this.svc.updateDraft(ctx, id, dto);
  }

  @RequirePermission('pricing.price-book.submit')
  @Post(':id/submit')
  submit(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.svc.submit(ctx, req.user.sub, id);
  }

  @RequirePermission('pricing.price-book.approve')
  @Post(':id/approve')
  approve(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.svc.approve(ctx, req.user.sub, id);
  }

  @RequirePermission('pricing.price-book.schedule')
  @Post(':id/schedule')
  schedule(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: SchedulePriceBookDto,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.schedule(ctx, req.user.sub, id, dto);
  }

  @RequirePermission('pricing.price-book.activate')
  @Post(':id/activate')
  activate(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.svc.activate(ctx, req.user.sub, id);
  }

  @RequirePermission('pricing.price-book.end')
  @Post(':id/end')
  end(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.svc.end(ctx, req.user.sub, id);
  }

  @RequirePermission('pricing.price-book.view')
  @Get(':id/entries')
  listEntries(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.listEntries(ctx, id);
  }

  @RequirePermission('pricing.price-entry.manage')
  @Post('entries')
  createEntry(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CreatePriceEntryDto,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.createEntry(ctx, req.user, dto);
  }

  @RequirePermission('pricing.price-entry.manage')
  @Post('entries/:id/supersede')
  supersedeEntry(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: SupersedePriceEntryDto,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.supersedeEntry(ctx, req.user, id, dto);
  }
}
