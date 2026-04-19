import { db, pool } from '../server/db/index.js';
import { users } from '../server/db/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: tsx scripts/promote-admin.ts <email>');
    process.exit(1);
  }

  const user = await db.select({ id: users.id, email: users.email, role: users.role, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .then(r => r[0]);

  if (!user) {
    console.error(`No user found with email ${email}. Have them sign up first.`);
    process.exit(1);
  }

  if (!user.emailVerified) {
    console.error(`User ${email} has not verified their email. Refusing to promote.`);
    process.exit(1);
  }

  if (user.role === 'admin') {
    console.log(`User ${email} is already an admin.`);
    process.exit(0);
  }

  await db.update(users)
    .set({ role: 'admin', updatedAt: new Date() })
    .where(eq(users.id, user.id));

  console.log(`Promoted ${email} (id=${user.id}) to admin.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
