# Bold CI Root Hard-Suite Fix

Target repository: `OsamaIbrhim/bold_system`

Target branch: `fix/ci-isolated-migration-databases`

Expected base commit: `96c1d22478c1d7f545a1ba5ccd445a4eaf90b5d0`

## Apply

From the repository root:

```bash
git rev-parse HEAD
git apply --check bold-ci-root-hard-suite-fix.patch
git apply bold-ci-root-hard-suite-fix.patch

cd backend
npm ci
npm run test:soft
cd ..

git diff --check
git status --short
```

Commit only after `npm run test:soft` passes:

```bash
git add \
  backend/package.json \
  backend/perf/inventory-ledger-smoke.mjs \
  backend/perf/transfer-state-smoke.mjs \
  backend/perf/run-hard-suite.mjs \
  backend/perf/support/transfer-command-context.mjs \
  backend/src/prisma/migration-ci-contract.spec.ts \
  backend/src/transfers/transfer-perf-contract.spec.ts

git commit -m "test: harden protected transfer smoke suites"
git push
```

Do not edit an existing migration, disable the transfer trigger, or add a
production/remote reset bypass.
