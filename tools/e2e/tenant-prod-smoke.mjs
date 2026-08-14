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

// Tenant PRODUCTION-MODE smoke (AGL-595) — the pre-deploy gate for
// request-time-only failures that dev servers and successful builds both
// miss. Lesson of the AGL-594 outage: `useSearchParams()` without a
// Suspense boundary 500s ONLY when an ISR route renders at request time
// in a production server — the dev server renders dynamically, the
// console app is fully dynamic, and the Vercel build has nothing to
// prerender, so every other gate stayed green while production burned.
//
// This script builds apps/tenant for production, starts the real
// `next start` server against the local emulator stack, requests the
// seeded routes, and asserts status + content.
//
// Prerequisites — the standard emulator stack (docs/E2E_LOCAL.md):
//   1. cd cloud && npx -y firebase-tools@13 emulators:start \
//        --config firebase.e2e.json --project aglyn-main --only auth,firestore
//   2. npm run seed:e2e
//   3. FIRESTORE_EMULATOR_HOST=localhost:8082 \
//      FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//        node tools/e2e/tenant-prod-smoke.mjs
//   (or: npm run smoke:tenant:prod)
//
// Port 4500 must be free (stop the tenant dev server first). The
// production build takes a few minutes; the wait budget accounts for it.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4500'
const BOOT_BUDGET_MS = Number(process.env.SMOKE_BOOT_BUDGET_MS ?? 120_000)

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  console.error(
    'Refusing to run: FIRESTORE_EMULATOR_HOST and ' +
      'FIREBASE_AUTH_EMULATOR_HOST must both point at local emulators ' +
      '(docs/E2E_LOCAL.md) so the production server can never touch ' +
      'production data.',
  )
  process.exit(1)
}

// Routes exist in the seed-e2e + guide fixtures; assert a content marker
// so a designed-but-empty 200 can't pass.
// `absent` is the scoped-sharing half (AGL-1047): a marker that must NOT
// appear. A boundary is only proven by a render that leaves data out while
// still succeeding, and only production mode proves it — the dev server
// renders dynamically and would mask an ISR-only failure.
const CHECKS = [
  { path: '/survey', marker: 'Tell us how we did' },
  { path: '/home', marker: 'Fresh sourdough' },
  {
    path: '/scoped',
    marker: 'Avery Quinn',
    absent: 'INTERNAL-RATE-CARD-SECRET',
  },
]

/**
 * AGL-1266: the served HTML must carry the app's emotion cache key, not
 * emotion's fallback.
 *
 * Emotion names classes `${cache.key}-${hash}`. When a SERVER render loses
 * the cache context, `@emotion/react`'s non-browser build does not throw — it
 * quietly builds `createCache({ key: 'css' })` and renders on. The page looks
 * perfect; the browser then hydrates under the real `mui` cache, every class
 * disagrees by its prefix alone, and React throws the whole server tree away.
 * That is the entire SSR/ISR benefit of the tenant, lost silently.
 *
 * This lives in the production smoke rather than a unit test on purpose. The
 * trigger is module-graph duplication — two instances of `@emotion/react` in
 * one render — which only a real `next build` can produce and only a real
 * render can reveal. Jest resolves one instance and would always pass.
 *
 * `expectPrefix` is the paired positive: an "absent css-" assertion passes
 * trivially against a page with no emotion styles at all, so the run also has
 * to prove the right prefix IS there.
 */
const EMOTION_FALLBACK_CLASS = /class="[^"]*\bcss-[a-z0-9]{5,}/
const EMOTION_EXPECTED_STYLE_TAG = 'data-emotion="mui'
const emotionCheck = (body) => {
  const fallback = body.match(EMOTION_FALLBACK_CLASS)
  if (fallback) return `emotion FALLBACK key on the server — ${fallback[0]}…`
  if (!body.includes(EMOTION_EXPECTED_STYLE_TAG))
    return `no ${EMOTION_EXPECTED_STYLE_TAG}" styles — cannot prove the key`
  return null
}

// `next start` on the dist artifact does NOT load apps/tenant/.env*
// (Next reads env from the directory it starts, and nx serve loads the
// project's files) — without them firebase-admin never initializes and
// every route 500s with "default Firebase app does not exist", masking
// the real signal. Load them here; the emulator overrides below win.
const parseEnvFile = (path) => {
  try {
    const out = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*)\s*$/)
      if (!match || match[1].startsWith('#')) continue
      out[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}
const smokeEnv = {
  ...parseEnvFile(join(repoRoot, 'apps/tenant/.env')),
  ...parseEnvFile(join(repoRoot, 'apps/tenant/.env.local')),
  ...process.env,
  FIREBASE_AUTH_EMULATOR_ENABLED: 'true',
  FIREBASE_FIRESTORE_EMULATOR_ENABLED: 'true',
  // AGL-1504: the AGL-1500 boot warmup sets `preferRest: true`, and REST
  // transport breaks the EMULATOR's admin bypass. Over gRPC the Admin SDK
  // sends `Authorization: Bearer owner` (injected as a custom header when
  // `FIRESTORE_EMULATOR_HOST` forces ssl:false) and the emulator waves
  // admin reads past the rules. Over REST every request goes through the
  // google-auth-library client (`auth.fetch` in gax's fallbackServiceStub),
  // which stamps a REAL OAuth token minted from the service account in
  // apps/tenant/.env over that header — the emulator can't parse it, treats
  // the read as unauthenticated, and rules-evaluates it to a denial
  // ("Property staff is undefined … for 'list'"). Every page then 404s and
  // this gate dies before asserting anything. The kill switch restores the
  // gRPC owner bypass; production keeps preferRest — the divergence exists
  // only against the emulator, which is the only place this harness runs.
  AGLYN_DISABLE_BOOT_WARMUP: '1',
  AGLYN_TENANT_DEMO: 'demo',
  NEXT_TELEMETRY_DISABLED: '1',
}

// Build EXPLICITLY and uncached, then `next start` the artifact. Do not
// route through `nx serve --configuration=production` — it happily
// reuses a stale dist/ from a previous run, which makes a gate that
// silently tests the WRONG code (observed while validating this
// harness: the pre-hotfix 500 only reproduced after a forced rebuild).
if (process.env.SMOKE_SKIP_BUILD === '1') {
  console.warn(
    'WARNING: SMOKE_SKIP_BUILD=1 — asserting against the EXISTING dist, ' +
    'INCLUDING ITS ISR CACHE, so a route can be served from a render made ' +
    'before your fixture change (x-nextjs-cache: STALE). That silently ' +
    'weakens the `absent` scope assertions into no-ops. Never trust a ' +
    'security result from this mode. ' +
      'Only for iterating on this harness; never a deploy gate.',
  )
} else {
  console.log('building apps/tenant for production (uncached)…')
}
if (process.env.SMOKE_SKIP_BUILD !== '1') {
  const build = spawn(
    'npx',
    ['nx', 'build', 'tenant', '--configuration=production', '--skip-nx-cache'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: smokeEnv },
  )
  let buildOutput = ''
  build.stdout.on('data', (chunk) => {
    buildOutput += String(chunk)
  })
  build.stderr.on('data', (chunk) => {
    buildOutput += String(chunk)
  })
  const buildCode = await new Promise((resolve) => build.on('exit', resolve))
  if (buildCode !== 0) {
    console.error('FAIL  tenant production build failed')
    console.error(buildOutput.split('\n').slice(-25).join('\n'))
    process.exit(1)
  }
}

console.log('starting the tenant production server…')
const server = spawn(
  'npx',
  ['next', 'start', 'dist/apps/tenant', '-p', '4500'],
  {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: smokeEnv,
  },
)
let serverOutput = ''
server.stdout.on('data', (chunk) => {
  serverOutput += String(chunk)
})
server.stderr.on('data', (chunk) => {
  serverOutput += String(chunk)
})

const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}
process.on('exit', stopServer)
process.on('SIGINT', () => process.exit(130))

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Wait for the server to answer at all (build + boot).
const deadline = Date.now() + BOOT_BUDGET_MS
let booted = false
while (Date.now() < deadline) {
  if (server.exitCode !== null) break
  try {
    await fetch(`${BASE}/survey`, { signal: AbortSignal.timeout(5000) })
    booted = true
    break
  } catch {
    await wait(3000)
  }
}
if (!booted) {
  console.error('FAIL  server never came up within the boot budget')
  console.error(serverOutput.split('\n').slice(-25).join('\n'))
  process.exit(1)
}

let failures = 0
for (const { path, marker, absent } of CHECKS) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(30_000),
    })
    const body = await res.text()
    const okStatus = res.status === 200
    const okMarker = body.includes(marker)
    // A leak is a failure even on a 200 with the right marker — the page
    // renders correctly AND carries a row it must never have loaded.
    const okAbsent = !absent || !body.includes(absent)
    // Only meaningful on a 200 — an error page proves nothing about the key.
    const emotionProblem = okStatus ? emotionCheck(body) : null
    const ok = okStatus && okMarker && okAbsent && !emotionProblem
    if (!ok) failures += 1
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${path} — HTTP ${res.status}` +
        `${okMarker ? '' : ` (marker "${marker}" missing)`}` +
        `${okAbsent ? '' : ` (LEAKED "${absent}")`}` +
        `${emotionProblem ? ` (${emotionProblem})` : ''}`,
    )
    if (!okStatus) {
      // Surface the server-side error the way the outage presented.
      const errorLines = serverOutput
        .split('\n')
        .filter((line) => /error|digest|⨯/i.test(line))
        .slice(-8)
      if (errorLines.length) console.error(errorLines.join('\n'))
    }
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${path} — ${String(error?.message ?? error)}`)
  }
}

stopServer()
console.log(
  failures
    ? `${failures} route(s) failed — do NOT deploy tenant changes`
    : 'tenant production smoke green',
)
process.exit(failures ? 1 : 0)
