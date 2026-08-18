/**
 * @license
 * Copyright 2023 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// MARK – IMPORTS
const path = require('path')
// eslint-disable-next-line @typescript-eslint/no-var-requires, @nx/enforce-module-boundaries
const withAglyn = require('../../with-aglyn.nextjs.config')
// eslint-disable-next-line @nx/enforce-module-boundaries
const { syncMonacoAssets } = require('../../tools/scripts/lib/sync-monaco-assets')

// MARK – GLOBALS
const isProduction = process.env.NODE_ENV !== 'production'

/**
 * Vendor Monaco into `public/monaco/vs` before Next reads `public/` (AGL-1779).
 *
 * The besigner's Edit -> Raw JSON opens `@aglyn/shared-ui-json-editor`, whose
 * `@monaco-editor/loader` otherwise injects a `<script>` from
 * `cdn.jsdelivr.net` into the `app.aglyn.com` origin — unpinned, un-SRI'd, and
 * permitted by the bare `https:` in this app's `script-src`. The matching
 * `loader.config({ paths: { vs: '/monaco/vs' } })` lives in
 * `libs/shared/ui/json-editor/src/lib/components/monaco-editor.tsx` and has NO
 * CDN fallback, so this copy is not optional — `syncMonacoAssets` throws and
 * fails the build rather than letting the editor 404 in production while
 * working locally.
 *
 * This runs here, at config load, because the config is the one step of a
 * console build guaranteed to execute no matter who invokes it: `nx build
 * console`, a bare `next build`, or Vercel's dashboard build command for the
 * `aglyn-console` project, whose root directory is the repo root and whose
 * command therefore lives outside this repo.
 */
syncMonacoAssets({ publicDir: path.join(__dirname, 'public') })

/**
 * The files `sharp` needs at runtime that NOTHING traces (AGL-1471).
 *
 * `/api/health` reported `imaging: { ok: false, code: 'sharp-unavailable' }`
 * on production minutes after AGL-1468's probe shipped, and every upload since
 * 2026-07-19 wrote `variants: []`. The module is externalised correctly and
 * `@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.3.node` IS in the route's
 * `.nft.json` — so the addon ships. What does not ship is the 17 MB
 * `@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.3` that the addon
 * declares as `DT_NEEDED` and finds through the RUNPATH
 * `$ORIGIN/../../sharp-libvips-linux-x64/lib`. `dlopen` fails, sharp's own
 * loader rethrows a plain `Error` carrying no `code`, and the probe reports
 * the fallback string. Verified: `libvips-cpp` appears in no `.nft.json` in
 * the entire build — only that package's `index.js`, `package.json` and
 * `versions.json`, which are the JS files a bundler CAN see.
 *
 * Nothing traces it because a shared object reached through the dynamic
 * linker is invisible to static analysis. `@vercel/nft` carries a `sharp`
 * special case for exactly this, and it is dead here twice over: it keys on
 * `id.endsWith('sharp/lib/index.js')`, which sharp 0.35 does not have (it
 * ships `dist/index.cjs`), and it resolves the platform packages at
 * `node_modules/@img/*`, where the root `overrides` pin from 55237eadd no
 * longer puts them.
 *
 * So the file list is stated here instead. Both layouts are listed on purpose:
 * the nested one is where the override puts them today, the hoisted one is
 * where npm would put them if that pin is ever lifted, and a glob that matches
 * nothing is silent — which is the failure mode this issue already paid for.
 * Neither glob is a size risk: npm only installs the platform packages that
 * match the install target, so this is ~17 MB of the ONE architecture being
 * built for, not twenty-five of them.
 */
const SHARP_NATIVE_LIBRARIES = [
  '../../node_modules/sharp/node_modules/@img/**',
  '../../node_modules/@img/**',
]

/**
 * @type {import('/tools/nextjs-base.config').WithAglynOptions}
 **/
module.exports = withAglyn({
  // experimental: { appDir: isProduction },
  env: {
    AGLYN_SILOED_HOST: process.env.AGLYN_SILOED_HOST,
    // Which deployment this build IS, in the CLIENT bundle (AGL-2067).
    //
    // `analyticsMayEmit` has to refuse a Vercel PREVIEW build, and a preview
    // build has `NODE_ENV === 'production'` — it is a production build of a
    // non-production deployment — so `NODE_ENV` alone cannot see it. `VERCEL_ENV`
    // can, but it is server-only: Next inlines `NEXT_PUBLIC_*` into browser code
    // and nothing else, so read from a client component it is simply undefined.
    //
    // Mapped explicitly here rather than relying on Vercel's "automatically
    // expose System Environment Variables" project setting. That setting is a
    // dashboard checkbox no spec in this repo can see, and a gate that is
    // silently not there is the failure mode this whole issue is about.
    // Undefined off Vercel, which `analyticsMayEmit` reads as "unknown
    // deployment" and lets emit — the self-host default.
    NEXT_PUBLIC_DEPLOY_ENV: process.env.VERCEL_ENV,
  },
  /**
   * The routes that call into `sharp` (AGL-1471, extended by AGL-1476).
   *
   * `/api/health` is listed with the ones that do the work, deliberately: it is
   * the probe that made this knowable, and a probe that runs in a lambda
   * assembled differently from the one it speaks for is worse than no probe —
   * it would report `ok: true` for a runtime that still cannot encode.
   *
   * `/api/media/upload-url` joined them when its finalize started generating
   * variants for signed-path images (AGL-1476). Leaving it out would reproduce
   * AGL-1471 exactly, on the one route this fix is about: the code would run,
   * the addon would ship, `libvips-cpp.so` would not, `dlopen` would fail, and
   * every large image would land with `variants: []` — the same empty array
   * the issue set out to fix, now with a `variantsError` attached. This list is
   * where a route becomes able to encode at all.
   */
  outputFileTracingIncludes: {
    '/api/health': SHARP_NATIVE_LIBRARIES,
    '/api/media/upload': SHARP_NATIVE_LIBRARIES,
    '/api/media/replace': SHARP_NATIVE_LIBRARIES,
    '/api/media/upload-url': SHARP_NATIVE_LIBRARIES,
  },
  // Same-origin Firebase auth helpers (AGL-462): OAuth redirect/popup
  // return legs break under third-party storage partitioning when the
  // authDomain is cross-origin (*.firebaseapp.com), which is why Google
  // sign-in from a mobile browser never completed. Proxying /__/* lets
  // the client use window.location.host as authDomain (see
  // resolveFirebaseAuthDomain) so the whole handshake stays same-site.
  async rewrites() {
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    if (!project) return []
    return [
      {
        source: '/__/:path*',
        destination: `https://${project}.firebaseapp.com/__/:path*`,
      },
    ]
  },
  // Manage → Org section move (AGL-236): old bookmarks keep working.
  async redirects() {
    return [
      ...['billing', 'team', 'support', 'marketplace'].map((section) => ({
        source: `/manage/${section}`,
        destination: `/org/${section}`,
        permanent: true,
      })),
    ]
  },
})
