import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

// Admin-only bootstrap script. Safe to run in dev and prod. No demo data,
// no fake users, no reference tables — creates exactly one ADMIN user and
// exits. The admin manages countries, cities, categories, vendors, and
// platform settings from /admin.
//
// Prod safety rails (all refuse startup, not silent defaults):
//   - SEED_ADMIN_PASSWORD is required. No "Admin123!" default in prod.
//   - Password must be at least 16 characters in prod.
//   - If the admin already exists, the script exits cleanly without touching
//     the row (use SEED_ADMIN_ALLOW_UPDATE=true to deliberately rotate the
//     password; same flag also clears lockout + verification state).
//   - The password is never echoed to logs in prod (prevents CloudWatch
//     capture).
//   - Operators can set SEED_ADMIN_PASSWORD_STDIN=true to read the password
//     from stdin instead of an env var, which keeps it out of shell history
//     and `/proc/<pid>/environ` on the host.

const PROD_MIN_PASSWORD_LENGTH = 16;

async function readPasswordFromStdin(): Promise<string> {
  process.stdout.write('Enter admin password (input hidden): ');
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const stdin = process.stdin;
    if (stdin.isTTY && typeof (stdin as { setRawMode?: (m: boolean) => void }).setRawMode === 'function') {
      (stdin as { setRawMode: (m: boolean) => void }).setRawMode(true);
    }
    stdin.on('data', (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 0x0d || byte === 0x0a || byte === 0x04) {
          process.stdout.write('\n');
          if (stdin.isTTY && typeof (stdin as { setRawMode?: (m: boolean) => void }).setRawMode === 'function') {
            (stdin as { setRawMode: (m: boolean) => void }).setRawMode(false);
          }
          stdin.pause();
          resolve(Buffer.concat(chunks).toString('utf8'));
          return;
        }
        chunks.push(Buffer.from([byte]));
      }
    });
  });
}

async function main() {
  const isProd = process.env.NODE_ENV === 'production';

  const email = process.env.SEED_ADMIN_EMAIL ?? (isProd ? null : 'jadwalit@gmail.com');
  let password = process.env.SEED_ADMIN_PASSWORD ?? (isProd ? null : 'Admin123!');
  if (process.env.SEED_ADMIN_PASSWORD_STDIN === 'true') {
    password = await readPasswordFromStdin();
  }
  const fullName = process.env.SEED_ADMIN_NAME ?? 'Platform Admin';
  const allowUpdate = process.env.SEED_ADMIN_ALLOW_UPDATE === 'true';

  if (!email || !password) {
    console.error(
      'FATAL: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required in production.',
    );
    process.exit(1);
  }

  if (isProd && password.length < PROD_MIN_PASSWORD_LENGTH) {
    console.error(
      `FATAL: SEED_ADMIN_PASSWORD must be at least ${PROD_MIN_PASSWORD_LENGTH} characters in production.`,
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && !allowUpdate) {
    console.log(`Admin already exists: ${existing.email} (role=${existing.role}).`);
    console.log('No changes made.');
    console.log('To deliberately rotate the password / clear lockout, rerun with SEED_ADMIN_ALLOW_UPDATE=true.');
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const hashedPassword = await bcrypt.hash(
    password,
    Number(process.env.BCRYPT_ROUNDS || 12),
  );

  const admin = existing
    ? await prisma.user.update({
        where: { email },
        data: {
          password: hashedPassword,
          role: 'ADMIN',
          emailVerified: true,
          phoneVerified: true,
          isDeactivated: false,
          verificationToken: null,
          verificationTokenExpiry: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      })
    : await prisma.user.create({
        data: {
          email,
          fullName,
          password: hashedPassword,
          role: 'ADMIN',
          emailVerified: true,
          phoneVerified: true,
        },
      });

  console.log(existing ? 'Admin user updated:' : 'Admin user created:');
  console.log('  email: ', admin.email);
  console.log('  role:  ', admin.role);
  if (!isProd) {
    console.log('  password:', password);
  }
  console.log('\nLog in at /login, then manage countries, cities, categories,');
  console.log('vendors, platform settings, etc. from /admin.');

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
