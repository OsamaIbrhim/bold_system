import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
const prisma = new PrismaClient();
async function main() {
  const branch = await prisma.branch.upsert({
    where: { code: 'BOLD-01' },
    update: {},
    create: { code: 'BOLD-01', name_ar: 'بولد – الفرع الرئيسي', name_en: 'Bold Main', cash_drawer_enabled: false }
  });
  const owner = await prisma.user.upsert({
    where: { phone: '+200100000000' },
    update: {},
    create: {
      name: 'Owner',
      phone: '+200100000000',
      email: 'owner@bold.eg',
      password_hash: await argon2.hash('Bold1234'),
      role: 'owner',
      branch_id: branch.id
    }
  });
  await prisma.pricingRule.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Global Default EG',
      scope_type: 'global',
      overhead_percent: 20,
      profit_percent: 35,
      tax_percent: 14,
      formula: 'compound',
      is_protected: true,
      priority: 999
    }
  });
  console.log('Seeded Bold: branch', branch.code, 'owner phone +200100000000 / Bold1234');
}
main().finally(() => prisma.$disconnect());
