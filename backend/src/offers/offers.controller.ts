import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { OffersService } from './offers.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { ReviewOfferDto } from './dto/review-offer.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
@Controller('offers')
@Roles('owner', 'branch_manager')
@RequireCapabilities('offers.manage')
export class OffersController {
  constructor(private svc: OffersService) {}
  @Get('suggestions')
  list(
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) { return this.svc.suggestions(resolveBranchScope(req.user, branch_id)); }
  @Post(':id/review')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewOfferDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) { return this.svc.review(id, dto.status, req.user); }
}
