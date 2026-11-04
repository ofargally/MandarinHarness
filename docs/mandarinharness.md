# MandarinHarness personal Mac build

Run `npm run desktop:dist` on an Apple Silicon Mac. This builds the standalone server, checks its runtime, and packages an unsigned app, DMG and ZIP in `dist/`. It does not publish. The existing static icon avoids requiring the original Icon Composer/Xcode build setup.

App identity: `com.ofargally.MandarinHarness`. Packaged settings and learning data live under `~/Library/Application Support/MandarinHarness`, separate from LearnHarness and the development checkout. Enter API keys in Settings after installation; no personal data or keys belong in the installer.

Updates are disabled by `mandarinHarness.updatesEnabled: false` in package.json, including manual checks. Install new personal builds manually. The packaging feed points to ofargally/MandarinHarness for future use; signed releases and automatic updates require a separate setup. Upstream release/signing instructions are not the personal build procedure.

Drag MandarinHarness.app into Applications from the DMG. This personal build is unsigned and not notarized; it does not have the distribution trust of the original signed release. Keep existing LearnHarness data intact; migration is a separate step.

## Current verification

The personal installer has not yet been produced. On November 4, 2026 the local Turbopack build failed because its worker could not bind a port. A Webpack diagnostic build then exposed a client import of `node:crypto` through `src/core/coverage.ts`. Typecheck and 58 focused speech/auth/updater tests pass; packaging and installed-app checks remain pending.
