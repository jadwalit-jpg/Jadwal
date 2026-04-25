/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // Default suite = regression + unit. Integration specs use `.int.spec.ts`
  // and require a running docker-compose; run them via `npm run test:int`.
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '\\.int\\.spec\\.ts$'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    // `file-type` is ESM-only (v18+). Jest's default resolver cannot load
    // its `"import"`-only export map. Redirect to a CJS stub that matches
    // the v18+ API surface so ts-jest type-checks cleanly. Any test that
    // cares about file-type already `jest.mock()`s it explicitly.
    '^file-type$': '<rootDir>/test/mocks/file-type.stub.ts',
  },
};
