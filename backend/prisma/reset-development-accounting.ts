import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config(
        'bold.inventory_ledger_maintenance',
        'on',
        true
      )
    `;
    await tx.$queryRaw`
      SELECT set_config(
        'bold.inventory_cost_ledger_maintenance',
        'on',
        true
      )
    `;
    await tx.$queryRaw`
      SELECT set_config(
        'bold.purchase_accounting_maintenance',
        'on',
        true
      )
    `;
    await tx.$queryRaw`
      SELECT set_config(
        'bold.transfer_maintenance',
        'on',
        true
      )
    `;

    await tx.transferTransitMovement.deleteMany();
    await tx.transferCommand.deleteMany();
    await tx.inventoryCostMovement.deleteMany();
    await tx.inventoryMovement.deleteMany();
    await tx.supplierReturnItem.deleteMany();
    await tx.supplierReturn.deleteMany();
    await tx.purchaseInvoiceItem.deleteMany();
    await tx.purchaseInvoice.deleteMany();
    await tx.transferItem.deleteMany();
    await tx.transfer.deleteMany();
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
