/**
 * Integration-test config — runs files matching *.int.spec.ts only.
 * Requires docker-compose (jadwal-db + jadwal-redis) up, and the
 * `jadwal_test` Postgres database created + migrated:
 *
 *   docker exec jadwal-db psql -U postgres -c "CREATE DATABASE jadwal_test;"
 *   DATABASE_URL="postgresql://postgres:admin123@localhost:5433/jadwal_test" \
 *     npx prisma migrate deploy
 *
 * Run: `npm run test:int`
 */

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.int\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  // Integration tests share a single Postgres connection — serial so two
  // suites don't race each other's TRUNCATE.
  maxWorkers: 1,
  // Docker round-trip + migration seed can push individual tests past the
  // 5s default. Bump to 30s floor; individual tests can tighten via timeout.
  testTimeout: 30_000,
};
