import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { BranchesModule } from './branches/branches.module';
import { ProductsModule } from './products/products.module';
import { PricingModule } from './pricing/pricing.module';
import { InventoryModule } from './inventory/inventory.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';
import { TransfersModule } from './transfers/transfers.module';
import { ReportsModule } from './reports/reports.module';
import { OffersModule } from './offers/offers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SyncModule } from './sync/sync.module';
import { ShiftsModule } from './shifts/shifts.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    BranchesModule,
    ProductsModule,
    PricingModule,
    InventoryModule,
    SuppliersModule,
    PurchasingModule,
    CustomersModule,
    SalesModule,
    TransfersModule,
    ReportsModule,
    OffersModule,
    NotificationsModule,
    SyncModule,
    ShiftsModule,
  ],
})
export class AppModule {}
