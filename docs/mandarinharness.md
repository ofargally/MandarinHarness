# MandarinHarness personal Mac build

Install dependencies with `npm ci`, then run `node node_modules/electron/install.js` if the Electron runtime is missing. Run `npm run desktop:dist` on an Apple Silicon Mac. This builds the standalone server, checks its runtime, and packages an unsigned app, DMG and ZIP in `dist/`. It does not publish. The existing static icon avoids requiring the original Icon Composer/Xcode build setup.

App identity: `com.ofargally.MandarinHarness`. Packaged settings and learning data live under `~/Library/Application Support/MandarinHarness`, separate from LearnHarness and the development checkout. Enter API keys in Settings after installation; no personal data or keys belong in the installer.

Updates are disabled by `mandarinHarness.updatesEnabled: false` in package.json, including manual checks. Install new personal builds manually. The packaging feed points to ofargally/MandarinHarness for future use; signed releases and automatic updates require a separate setup. Upstream release/signing instructions are not the personal build procedure.

Drag MandarinHarness.app into Applications from the DMG. This personal build is unsigned and not notarized; it does not have the distribution trust of the original signed release. Keep existing LearnHarness data intact; migration is a separate step.

## Current verification

On November 4, 2026, `npm run desktop:dist` completed successfully and produced:

- `dist/MandarinHarness-0.4.1-arm64.dmg`
- `dist/MandarinHarness-0.4.1-arm64-mac.zip`
- `dist/mac-arm64/MandarinHarness.app`

The desktop command uses Webpack because Turbopack's CSS worker cannot bind its required port in the build environment. The browser-safe core barrel no longer exports the Node-only coverage module. Tracing excludes only the root learner-data folder and explicitly includes dynamic teaching prompts and two Next router metadata dependencies.

Production compilation/typechecking, provider initialization, payload checks, Electron server startup/API probes and compression checks passed. 59 focused coverage/speech/updater tests and the Chrome selection smoke passed. Lint has one pre-existing source-name-ui warning; the build has a dynamic-import warning in electron/subscriptions.cjs.

The actual packaged app was launched twice with a throwaway profile. Disabled automatic/manual updates, highlighted-text playback using an existing MP3, and disk-cache reuse after restart passed. No paid synthesis or real credentials were used. Reproduce with `node --import tsx scripts/smoke-personal-app.mjs /path/to/existing.mp3`; the MP3 is an offline playback fixture, not bundled in the installer. This checks playback mechanics, not pronunciation quality or a model-driven lesson. The app has not been copied into Applications and no existing learning data was migrated.
