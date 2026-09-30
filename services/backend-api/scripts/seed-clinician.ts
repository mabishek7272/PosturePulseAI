/**
 * Creates (or updates the password of) a clinician account. There is no
 * self-service signup or admin UI this phase (docs/adr/010-clinician-authentication.md)
 * - this script is the only way to provision an account, run by whoever
 * operates the deployment.
 *
 * Usage: npx ts-node scripts/seed-clinician.ts <username> <password>
 */
import { PrismaClient } from "@prisma/client";
import { AuthService } from "../src/auth/auth.service";

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Usage: npx ts-node scripts/seed-clinician.ts <username> <password>");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Refusing to seed a password shorter than 12 characters.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await AuthService.hashPassword(password);
    const clinician = await prisma.clinician.upsert({
      where: { username },
      create: { username, passwordHash, role: "clinician" },
      update: { passwordHash },
    });
    console.log(`Clinician account ready: ${clinician.username} (id ${clinician.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
