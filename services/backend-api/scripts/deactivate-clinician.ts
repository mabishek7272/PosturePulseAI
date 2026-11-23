/**
 * Deactivates (or, with --reactivate, reactivates) a clinician account.
 * Deactivating revokes every refresh token at once, and the account can no
 * longer log in or refresh. An access token already issued keeps working until
 * it expires (ACCESS_TOKEN_TTL, default 1h).
 *
 * Usage: npx ts-node scripts/deactivate-clinician.ts <username> [--reactivate]
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const args = process.argv.slice(2);
  const reactivate = args.includes("--reactivate");
  const username = args.find((a) => !a.startsWith("--"));
  if (!username) {
    console.error("Usage: npx ts-node scripts/deactivate-clinician.ts <username> [--reactivate]");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const clinician = await prisma.clinician.findUnique({ where: { username } });
    if (!clinician) {
      console.error(`No clinician named ${username}.`);
      process.exit(1);
    }
    if (reactivate) {
      await prisma.clinician.update({ where: { id: clinician.id }, data: { deactivatedAt: null } });
      console.log(`Reactivated ${username}. They must log in again.`);
      return;
    }
    await prisma.clinician.update({ where: { id: clinician.id }, data: { deactivatedAt: new Date() } });
    const revoked = await prisma.refreshToken.updateMany({
      where: { clinicianId: clinician.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "account_deactivated" },
    });
    console.log(`Deactivated ${username}; revoked ${revoked.count} active session(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
