import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('bold.inventory_ledger_maintenance', 'on', true)
    `;
    await tx.inventoryMovement.deleteMany();
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
