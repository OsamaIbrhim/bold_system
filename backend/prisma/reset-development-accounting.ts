import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function assertDevelopmentResetAllowed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to reset development accounting while NODE_ENV=production.',
    );
  }

  if (
    process.env.ALLOW_DEVELOPMENT_ACCOUNTING_RESET !==
    'reset-development-accounting'
  ) {
    throw new Error(
      'Development accounting reset is destructive. Set ' +
        'ALLOW_DEVELOPMENT_ACCOUNTING_RESET=reset-development-accounting ' +
        'only for an isolated development or test database.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for the development reset.');
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL.');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (
    !localHosts.has(hostname) &&
    process.env.ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET !== '1'
  ) {
    throw new Error(
      `Refusing to reset remote database host ${hostname}. Set ` +
        'ALLOW_REMOTE_DEVELOPMENT_ACCOUNTING_RESET=1 only for a disposable ' +
        'remote test database.',
    );
  }
}

async function main() {
  assertDevelopmentResetAllowed();

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT
        set_config('bold.inventory_ledger_maintenance', 'on', true),
        set_config('bold.inventory_cost_ledger_maintenance', 'on', true),
        set_config('bold.purchase_accounting_maintenance', 'on', true),
        set_config('bold.transfer_maintenance', 'on', true)
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
  }, {
    maxWait: 15_000,
    timeout: 120_000,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
