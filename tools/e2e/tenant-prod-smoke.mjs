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
// seeded routes, and asserts status + content + TIME.
//
// Every route has a render budget (AGL-3566), SMOKE_ROUTE_BUDGET_MS, 15 s by
// default, and the time each took is printed. A route that has not answered
// in full by then fails, named. The beta.222 outage (AGL-3565) was a page
// that never answered: the site layout awaited a theme-font fetch that never
// settled, every uncached client page hit Vercel's 60 s limit, and this smoke
// stayed green — its `demo` host loads no fonts, so the await returned at
// once, and a 30 s timeout per route would have been the only bound anyway.
//
// So it now renders a site shaped like a client's too (`ridgeline`, seeded by
// tools/scripts/lib/seed-client-site.mjs): theme fonts, favicon and app icon,
// logo, shared layout, a reusable component, a dataset repeat, a form and a
// booking widget. And it renders that site TWICE, on two servers:
//
//   1. live      — the font origin is the real Google. Proves the self-hosted
//                  font path renders, and prints which way the fonts came
//                  (inlined, or the linked fallback when Google was slow).
//   2. font origin hung — the same build, a second `next start` with
//                  tools/e2e/lib/hung-font-origin.mjs preloaded, so every
//                  fetch to fonts.googleapis.com answers with a promise that
//                  never settles. The page must still render within budget,
//                  in its sized local fallbacks, and name no Google origin
//                  (AGL-3656: a render that cannot read Google links nothing
//                  from Google). Rendered on a second copy of the
//                  site (`ridgeline-stalled`) because pass 1 cached the first
//                  copy's pages, and a cached page proves nothing.
//
// Pass 2 is the deterministic half: a hung third party is the incident, and
// off Vercel the real Google answers in milliseconds, so pass 1 alone would
// not have caught it. Run against the pre-hotfix `self-hosted-fonts.ts`
// (91fb65f85d), pass 2 reds both client routes with "no complete response
// within the render budget"; against the hotfix (AGL-3564) it is green.
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
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { CLIENT_SITE_FIXTURE } from '../scripts/lib/seed-client-site.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4500'
const BOOT_BUDGET_MS = Number(process.env.SMOKE_BOOT_BUDGET_MS ?? 120_000)
/**
 * How long one route may take to answer IN FULL — headers and body — before
 * it fails (AGL-3566). Production's ceiling is the 60 s function limit, and a
 * page anywhere near it is already broken for its visitor; 15 s leaves a cold
 * first render on a 4-vCPU runner several times its measured cost, while a
 * render that waits on a hung dependency cannot get under it.
 */
const ROUTE_BUDGET_MS = Number(process.env.SMOKE_ROUTE_BUDGET_MS ?? 15_000)

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

// Routes exist in the seed-e2e + guide fixtures; assert content markers
// so a designed-but-empty 200 can't pass. A marker is a string or a RegExp,
// and every one in `markers` must be present.
// `absent` is the scoped-sharing half (AGL-1047): a marker that must NOT
// appear. A boundary is only proven by a render that leaves data out while
// still succeeding, and only production mode proves it — the dev server
// renders dynamically and would mask an ISR-only failure.
// `host` picks the site through the tenant-host cookie the middleware reads
// on `localhost:4500`; without it the request is the `demo` site.
const C = CLIENT_SITE_FIXTURE
/** What every page of the client site carries, whichever way its fonts came. */
const clientChrome = [
  // The shared layout rendered around the page.
  C.markers.layoutFooter,
  // The header's logo image, from the media library.
  'seed-client-logo',
  // Favicon and app icon, each size derived and versioned by its content
  // hash — the projected read of their media documents ran (AGL-3484).
  'v=seedfav01',
  'v=seedapp01',
]
const clientPages = (host) => [
  {
    host,
    path: '/',
    markers: [
      C.markers.hero,
      C.markers.componentHeadline,
      C.markers.projectRow,
      ...clientChrome,
    ],
  },
  {
    host,
    path: '/contact',
    markers: [C.markers.formLabel, ...clientChrome],
  },
]
/**
 * What `lib/hung-font-origin.mjs` prints when it loads and when it holds a
 * request. Spelled out here rather than imported: importing that module
 * INSTALLS it, and this process must keep its own fetch.
 */
const HUNG_FONT_ORIGIN_INSTALLED = '[hung-font-origin] installed'
const HUNG_FONT_ORIGIN_HELD = '[hung-font-origin] holding open forever'
/** The theme's fonts reached the page inlined (AGL-3485). */
const SELF_HOSTED_FONTS = 'aglyn-theme-fonts'
/** ...or as Google's linked stylesheet, which a published page never uses. */
const LINKED_FONTS = 'fonts.googleapis.com/css2?family=Montserrat'
/** Any reference to Google's font origins in the served HTML. */
const GOOGLE_FONT_ORIGIN = /fonts\.(googleapis|gstatic)\.com/
const fontsDelivery = (body) =>
  body.includes(SELF_HOSTED_FONTS)
    ? 'fonts inlined'
    : body.includes(LINKED_FONTS)
      ? 'fonts linked'
      : null

const PHASES = [
  {
    name: 'live',
    env: {},
    checks: [
      { path: '/survey', markers: ['Tell us how we did'] },
      { path: '/home', markers: ['Fresh sourdough'] },
      {
        path: '/scoped',
        markers: ['Avery Quinn'],
        absent: 'INTERNAL-RATE-CARD-SECRET',
      },
      // Either delivery is a pass here: Google may be slow from a runner, and
      // the fallback is the designed answer to that.
      ...clientPages(C.hostId).map((check) => ({ ...check, fonts: 'either' })),
    ],
  },
  {
    name: 'font origin hung',
    // Appended, so an operator's own NODE_OPTIONS survive.
    env: {
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        '--import',
        pathToFileURL(join(repoRoot, 'tools/e2e/lib/hung-font-origin.mjs'))
          .href,
      ]
        .filter(Boolean)
        .join(' '),
    },
    // Next's data cache is a directory in the build, and pass 1 stored the
    // stylesheet there for a day; left in place, pass 2 reads it and never
    // asks the hung origin at all. Cleared, the pass starts where a cold
    // region does — nothing stored, the origin the only answer.
    beforeStart: () =>
      rmSync(join(repoRoot, 'dist/apps/tenant/.next/cache/fetch-cache'), {
        recursive: true,
        force: true,
      }),
    // The page renders, in budget, in the sized local fallbacks its inlined
    // rules declare, and sends the visitor to no Google origin: a hung font
    // origin costs the typeface on that render, never the page (AGL-3656).
    checks: clientPages(C.stalledHostId).map((check) => ({
      ...check,
      fonts: 'no-google',
    })),
    // Proof the fault was live, read back from the server: the preload
    // loaded, and at least one stylesheet request was really held.
    serverPrinted: [HUNG_FONT_ORIGIN_INSTALLED, HUNG_FONT_ORIGIN_HELD],
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One `next start` of the built artifact, with `extraEnv` over the smoke's. */
const startServer = (extraEnv) => {
  const child = spawn(
    'npx',
    ['next', 'start', 'dist/apps/tenant', '-p', '4500'],
    {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...smokeEnv, ...extraEnv },
    },
  )
  const handle = { child, output: '' }
  child.stdout.on('data', (chunk) => {
    handle.output += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    handle.output += String(chunk)
  })
  return handle
}

let current = null
const killGroup = (child) => {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}
process.on('exit', () => current && killGroup(current.child))
process.on('SIGINT', () => process.exit(130))

/** Stops the running server and waits until it has let go of the port. */
const stopAndWait = async () => {
  if (!current) return
  const { child } = current
  current = null
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    killGroup(child)
    await Promise.race([exited, wait(15_000)])
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fetch(BASE, { signal: AbortSignal.timeout(1000) })
      await wait(500)
    } catch {
      return
    }
  }
}

/** Waits for the server to answer at all (boot), or reports why it did not. */
const waitForBoot = async () => {
  const deadline = Date.now() + BOOT_BUDGET_MS
  while (Date.now() < deadline) {
    if (current.child.exitCode !== null) break
    try {
      await fetch(`${BASE}/survey`, { signal: AbortSignal.timeout(5000) })
      return true
    } catch {
      await wait(3000)
    }
  }
  return false
}

const serverErrorLines = () =>
  current.output
    .split('\n')
    .filter((line) => /error|digest|⨯/i.test(line))
    .slice(-8)

/**
 * One route: status, markers, absent, emotion key, font delivery — and the
 * time to the LAST byte, against the route budget (AGL-3566). The abort is
 * the budget itself, so a render that never finishes fails at the budget with
 * its name on it rather than hanging the job.
 */
const runCheck = async ({ path, host, markers, absent, fonts }) => {
  const label = `${host ?? 'demo'} ${path}`
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  let res
  let body
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: host ? { cookie: `aglyn-tenant-host=${host}` } : {},
      signal: AbortSignal.timeout(ROUTE_BUDGET_MS),
    })
    body = await res.text()
  } catch (error) {
    const timedOut =
      error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError'
    console.log(
      timedOut
        ? `FAIL  ${label} — no complete response within the ` +
            `${ROUTE_BUDGET_MS} ms render budget (SMOKE_ROUTE_BUDGET_MS). ` +
            'A render waiting on something that never answers presents ' +
            'exactly like this (AGL-3565).'
        : `FAIL  ${label} — ${String(error?.message ?? error)} after ${elapsed()} ms`,
    )
    return false
  }
  const ms = elapsed()
  const okStatus = res.status === 200
  const missing = markers.filter((marker) =>
    marker instanceof RegExp ? !marker.test(body) : !body.includes(marker),
  )
  // A leak is a failure even on a 200 with the right marker — the page
  // renders correctly AND carries a row it must never have loaded.
  const okAbsent = !absent || !body.includes(absent)
  // Only meaningful on a 200 — an error page proves nothing about the key.
  const emotionProblem = okStatus ? emotionCheck(body) : null
  const delivery = fonts ? fontsDelivery(body) : null
  const fontsProblem = !fonts
    ? null
    : !delivery
      ? 'the theme fonts reached the page neither inlined nor linked'
      : fonts === 'no-google' && GOOGLE_FONT_ORIGIN.test(body)
        ? 'the page names a Google font origin; a published page never does'
        : fonts === 'no-google' && delivery !== 'fonts inlined'
          ? `expected the inlined rules, got ${delivery}`
          : null
  const ok =
    okStatus && !missing.length && okAbsent && !emotionProblem && !fontsProblem
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label} — HTTP ${res.status} in ${ms} ms` +
      `${delivery ? `, ${delivery}` : ''}` +
      `${missing.length ? ` (missing ${missing.map((m) => `"${m}"`).join(', ')})` : ''}` +
      `${okAbsent ? '' : ` (LEAKED "${absent}")`}` +
      `${emotionProblem ? ` (${emotionProblem})` : ''}` +
      `${fontsProblem ? ` (${fontsProblem})` : ''}`,
  )
  if (!okStatus) {
    // Surface the server-side error the way the outage presented.
    const errorLines = serverErrorLines()
    if (errorLines.length) console.error(errorLines.join('\n'))
  }
  return ok
}

let failures = 0
for (const phase of PHASES) {
  console.log(
    `starting the tenant production server — ${phase.name} ` +
      `(render budget ${ROUTE_BUDGET_MS} ms per route)…`,
  )
  phase.beforeStart?.()
  current = startServer(phase.env)
  if (!(await waitForBoot())) {
    console.error(`FAIL  server never came up within the boot budget (${phase.name})`)
    console.error(current.output.split('\n').slice(-25).join('\n'))
    process.exit(1)
  }
  for (const check of phase.checks) {
    if (!(await runCheck(check))) failures += 1
  }
  for (const line of phase.serverPrinted ?? []) {
    if (current.output.includes(line)) continue
    failures += 1
    console.log(
      `FAIL  ${phase.name} — the server never printed "${line}", so this ` +
        'pass did not run under the fault it exists to test',
    )
  }
  await stopAndWait()
}

console.log(
  failures
    ? `${failures} route(s) failed — do NOT deploy tenant changes`
    : 'tenant production smoke green',
)
process.exit(failures ? 1 : 0)
