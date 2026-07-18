/**
 * @license
 * Copyright 2026 Aglyn LLC
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

// Authenticated console e2e against the local Firebase emulators.
//
// Prerequisites (see docs/E2E_LOCAL.md):
//   1. Emulators running (auth 9099, firestore 8082).
//   2. `node tools/scripts/seed-e2e.mjs` has run.
//   3. Console dev server running WITH the emulator flags:
//        FIREBASE_AUTH_EMULATOR_ENABLED=true \
//        FIREBASE_FIRESTORE_EMULATOR_ENABLED=true npx nx serve console
//
// Then:  node tools/e2e/console.e2e.mjs
//
// Auth is bootstrapped without the UI: REST signInWithPassword against
// the auth emulator, then the session blob is injected into
// localStorage (`firebase:authUser:<apiKey>:DEFAULT_AGLYN`) before any
// page script runs, so the SDK restores the signed-in user on load.
//
// The specs are the five pages that historically rendered empty under
// the emulator (seed/query-shape mismatch — see docs/E2E_LOCAL.md);
// they are the regression canary for the whole authenticated read path.

import { readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099'
const HOST_ID = process.env.E2E_HOST ?? 'demo'
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@aglyn.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-1'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 45_000)
const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? join(repoRoot, 'tmp', 'e2e-artifacts')

/** The web API key the console bundle was built with — the localStorage
 * key embeds it, so it must match the app's env, not a placeholder. */
function resolveApiKey() {
  if (process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY) {
    return process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY
  }
  for (const file of ['.env.development.local', '.env.local']) {
    try {
      const raw = readFileSync(join(repoRoot, 'apps/console', file), 'utf8')
      const match = raw.match(/^NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY="?([^"\n]+)"?/m)
      if (match) return match[1]
    } catch {
      // File absent — try the next one.
    }
  }
  throw new Error(
    'Could not resolve NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY (env or apps/console/.env*)',
  )
}

/** REST sign-in against the auth emulator; no UI flow in tests. */
async function signIn(apiKey) {
  const response = await fetch(
    `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        returnSecureToken: true,
      }),
    },
  )
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(
      `Emulator sign-in failed (${payload?.error?.message ?? response.status}) — did seed-e2e.mjs run?`,
    )
  }
  return payload
}

function chromeExecutable() {
  if (process.env.E2E_CHROME_PATH) return { executablePath: process.env.E2E_CHROME_PATH }
  if (process.platform === 'darwin') {
    // First installed Chrome flavor wins — a Chrome update/uninstall must
    // not break the suite (it did once: only Beta was installed).
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for (const executablePath of candidates) {
      try {
        readFileSync(executablePath)
        return { executablePath }
      } catch {
        // Not installed — try the next flavor.
      }
    }
  }
  return { channel: 'chrome' }
}

// ── Specs: the historical "empty page" canaries + a dashboard sanity ───────
const specs = [
  { name: 'dashboard', path: `/${HOST_ID}`, expects: ['Demo Bakery'] },
  // The dataset name sits in a collapsed select; assert on a record row.
  { name: 'data', path: `/${HOST_ID}/data`, expects: ['Avery Quinn'] },
  { name: 'media', path: `/${HOST_ID}/media`, expects: ['hero.jpg'] },
  { name: 'content', path: `/${HOST_ID}/content`, expects: ['Blog'] },
  {
    name: 'bookings',
    path: `/${HOST_ID}/bookings`,
    expects: ['Cake tasting', 'Grace Hopper'],
  },
  {
    name: 'contacts',
    path: `/${HOST_ID}/contacts`,
    expects: ['wholesale@example.com'],
  },
  // ── July 2026 feature-wave surfaces ──────────────────────────────────
  {
    // Marketing hub: at-a-glance rollup (v8), overlay engagement stats
    // (AGL-271), merge-tag composer + scheduled campaign chip (AGL-272),
    // experiments card (AGL-252/273).
    name: 'marketing',
    path: `/${HOST_ID}/marketing`,
    expects: [
      'At a glance',
      'Overlay views',
      'Welcome bar',
      'Scheduled',
      'Hero copy test',
    ],
  },
  {
    // Logic page: variables/functions plus the Reference health audit
    // (wave v7) — the seed's references all resolve.
    name: 'logic',
    path: `/${HOST_ID}/logic`,
    expects: [
      'OrderTotal',
      'Reference health',
      'Every automation, workflow, and variable reference resolves.',
    ],
  },
  {
    // Workflows page: the automation + workflow rows with their Runs
    // logs (AGL-266 / wave v6).
    name: 'workflows',
    path: `/${HOST_ID}/workflows`,
    expects: ['DozenQuote', 'Form thank-you', 'Runs'],
  },
  {
    // Org billing: business plan card + Stripe Billing Portal link
    // (wave v5); active subscription shows the cancel flow (AGL-269).
    name: 'billing',
    path: '/org/billing',
    expects: ['Manage payment methods', 'Cancel subscription'],
    // Annual toggle (AGL-532): flipping it swaps every plan card to the
    // annual headline price (Starter $25/mo -> $16/mo billed yearly).
    interact: async (page) => {
      await page.waitForSelector('text=$25', {
        timeout: TIMEOUT_MS,
        state: 'attached',
      })
      await page.click('text=Monthly billing (switch for 2 months free)')
      await page.waitForSelector('text=/month, billed yearly', {
        timeout: TIMEOUT_MS,
        state: 'attached',
      })
      await page.waitForSelector('text=$16', {
        timeout: TIMEOUT_MS,
        state: 'attached',
      })
    },
  },
  {
    // Notifications: the seeded billing.usage entry (wave v5 taxonomy)
    // + per-category mute switches (AGL-267).
    name: 'notifications',
    path: '/manage/notifications',
    expects: ["You're above 80%", 'Forms & bookings'],
  },
  {
    // Plugins & add-ons hub (AGL-423): the first-party switchboard card
    // + the community plugin's installed add-ons section (widget slot).
    name: 'org-plugins',
    path: '/org/plugins',
    expects: ['Save plugins', 'Marketplace add-ons', 'Installed plugins'],
  },
  {
    // Staff review queue (AGL-432): the seeded submitted listing + its
    // lifecycle actions.
    name: 'plugin-reviews',
    path: '/admin/plugin-reviews',
    expects: ['Pending Review Plugin', 'Start review', 'Grant realm trust'],
  },
  {
    // Listing detail v2 (AGL-430/431): publisher README rendered through
    // markdown-lite, changelog from the public versions API, links card.
    name: 'listing-detail',
    path: `/${HOST_ID}/community/realm-demo`,
    expects: ['Realm demo', 'Versions & changelog', 'Source repository'],
  },
]

const apiKey = resolveApiKey()
// Fail fast with a clear message when the seed hasn't run — the UI
// sign-in below would otherwise fail cryptically.
await signIn(apiKey)
mkdirSync(ARTIFACTS, { recursive: true })

// Pre-warm: the dev server compiles pages on first hit, which can eat
// the whole navigation timeout for heavy pages (the dashboard). Compile
// them before the browser is on the clock. No-op on a warm server.
for (const spec of specs) {
  await fetch(`${BASE_URL}${spec.path}`).catch(() => undefined)
}

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

// Sign in through the real UI once. Injecting a synthetic localStorage
// session instead races the app's connectAuthEmulator call (the SDK
// throws if auth already started restoring a persisted user; the app
// swallows it and auth silently points at production), which made
// Firestore listens run unauthenticated on roughly half the loads. The
// UI flow exercises the app's own emulator wiring, and the session it
// persists is valid for every subsequent page in this context.
{
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/signin`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  await page.fill('input[type="email"], input[name="email"]', EMAIL, {
    timeout: TIMEOUT_MS,
  })
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"], button:has-text("Next")')
  // Signed-in proof: the router leaves /signin.
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), {
    timeout: TIMEOUT_MS,
  })
  await page.close()
  console.log(`signed in through the UI as ${EMAIL}`)
}

let failures = 0
for (const spec of specs) {
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const started = Date.now()
  try {
    await page.goto(`${BASE_URL}${spec.path}`, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS,
    })
    for (const text of spec.expects) {
      // `state: 'attached'` (not the default 'visible'): the HubTabs pages
      // (marketing, workflows) keep every tab panel mounted for its data
      // subscriptions, so MUI marks inactive panels `hidden`. Asserting the
      // text is in the DOM still proves the app rendered it — a crashed page
      // renders an error boundary, not this content.
      await page.waitForSelector(`text=${text}`, {
        timeout: TIMEOUT_MS,
        state: 'attached',
      })
    }
    // Optional interaction step (AGL-532): specs can drive the page and
    // assert the outcome beyond static text presence.
    if (spec.interact) await spec.interact(page)
    console.log(
      `PASS  ${spec.name.padEnd(10)} ${spec.path} (${Date.now() - started}ms)`,
    )
  } catch (error) {
    failures += 1
    const screenshot = join(ARTIFACTS, `${spec.name}.png`)
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined)
    console.error(`FAIL  ${spec.name.padEnd(10)} ${spec.path}`)
    console.error(`      ${String(error?.message ?? error).split('\n')[0]}`)
    console.error(`      screenshot: ${screenshot}`)
    if (consoleErrors.length) {
      console.error(`      console errors (${consoleErrors.length}):`)
      for (const line of consoleErrors.slice(0, 5)) {
        console.error(`        ${line.slice(0, 200)}`)
      }
    }
  } finally {
    await page.close()
  }
}

await browser.close()
console.log(
  failures
    ? `\n${failures}/${specs.length} specs failed`
    : `\nAll ${specs.length} specs passed`,
)
process.exit(failures ? 1 : 0)
