# Production QA

All checks use browser/Node built-ins only; no external test library is required for the smoke/load harness.

## Static smoke
`node tests/production-smoke.mjs`

## 1,000-request acceptance test
Run only against the deployed Worker after D1/R2/secrets are configured:

`node tests/load-test.mjs https://<worker-origin> 1000`

A local/static pass is not a substitute for the production 1,000-concurrent acceptance criterion. No live result is claimed until this command is run against the real deployment.
