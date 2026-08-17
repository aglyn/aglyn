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

// STARTER TEMPLATES → A SITE ROOT THAT SERVES — WIRE PROOF (AGL-1575).
//
// AGL-1575's verification bar is not a unit test and says so: "apply each of
// the five starters to a scratch host and confirm the resulting site's ROOT
// URL serves content. The bug is invisible at the console layer, which is
// exactly why it survived." The fix (`a40d3efa4`) shipped with that bar met
// once, by hand, through the console UI; nothing re-runnable recorded it, so
// the claim decayed into an assertion about itself. This is that bar as a
// harness, modelled on `lockdown-readonly-wire.mjs` (AGL-1626): arrange state
// against the emulator, then observe a real `next build` / `next start`
// tenant on the wire and record status codes and body markers.
//
// WHAT IS REAL HERE AND WHAT IS NOT — read this before trusting a PASS.
//
//   REAL, loaded from the shipped console modules through `jiti`, never
//   re-implemented (re-implementing them would prove nothing, because they
//   ARE the fix):
//     - `STARTER_TEMPLATES`            (apps/console/constants/starter-templates.ts)
//     - `buildStarterTemplateDocs`     (       "                "                 )
//     - `withBundleRootScreen`         (components/templates/create-page-from-template.ts)
//     - `resolveTemplateSlug`          (       "                "                 )
//   The apply loop below is a transcription of `template-gallery-dialog`'s
//   `handleUse` (`for (const screen of withBundleRootScreen(...)) …`), and it
//   runs BOTH sources that loop can be fed: the VIRTUAL starter (a host that
//   has never materialized it — the first-run path, since `/api/hosts/create`
//   deliberately seeds no starters) and the MATERIALIZED library documents
//   `buildStarterTemplateDocs` writes, which is where AGL-1575's second bug
//   lived (`...(screen.slug ? {slug} : {})` discarded a root slug outright).
//
//   HARNESS-SIDE, and therefore proving nothing on its own: the three document
//   writes `createPageFromTemplate` performs — screen doc, version doc,
//   routing-map entry. In production those ride `/api/hosts/resources`,
//   `/api/hosts/versions` and `publishScreenRoute`; here they are the same
//   documents written with the admin SDK, because the interesting question is
//   not whether Firestore accepts a write, it is which PATH the fixed code
//   decides on and whether the tenant then serves it.
//
// Prerequisites:
//   1. Emulators (auth 9099, firestore 8082): `npm run firebase:emulate`.
//      Port 4500 MUST be free — `apps/tenant/middleware.ts` recognizes
//      `localhost:4500` and `*.localhost:4500` and NOTHING else locally, so a
//      tenant bound anywhere else 307s every page to app.aglyn.com with no
//      error, which reads exactly like the 404 this issue is about.
//      (firebase-tools defaults its logging emulator to 4500; `82785cd57`
//      pinned it to 4520 in cloud/firebase.json — be on that commit.)
//   2. `npm run seed:e2e` (only for the `demo` control below; the scratch
//      hosts this harness probes are all created and deleted by it).
//   3. FIRESTORE_EMULATOR_HOST=localhost:8082 \
//      FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//        node tools/e2e/starter-root-wire.mjs
//
// Env:
//   WIRE_SKIP_BUILD=1   assert against the existing dist. Safe here in a way
//                       it is not for most render assertions: every host this
//                       harness probes is named with a fresh run id, so no ISR
//                       entry for it can exist in a dist built before the run.
//   WIRE_KEEP=1         leave the scratch hosts behind for inspection.
//
// NO STRIPE, EVER. Every probe is a GET of a page. The shop starters' cart and
// checkout screens are created but never POSTed to; localhost carries the LIVE
// Stripe key.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setDefaultResultOrder } from 'node:dns'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createJiti } from 'jiti'

// `<sub>.localhost` resolves to BOTH `::1` and `127.0.0.1` on macOS and Node
// prefers the v6 answer, while `next start` listens on IPv4 only — so every
// probe would fail as a connection error and read like a dead server. Setting
// the order is the whole fix; the Host header still travels from the URL,
// which is what `apps/tenant/middleware.ts` switches on.
setDefaultResultOrder('ipv4first')

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = Number(process.env.WIRE_PORT ?? 4500)
const BASE_HOSTNAME = process.env.WIRE_BASE_HOSTNAME ?? 'localhost'
const ORG_ID = process.env.WIRE_ORG ?? 'e2e-owner'
const OWNER_UID = 'e2e-owner'
const CONTROL_HOST = process.env.WIRE_CONTROL_HOST ?? 'demo'
const BOOT_BUDGET_MS = Number(process.env.WIRE_BOOT_BUDGET_MS ?? 180_000)

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  console.error(
    'Refusing to run: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST ' +
      'must both point at local emulators. This harness CREATES AND DELETES ' +
      'HOSTS — it must never be able to reach production.',
  )
  process.exit(1)
}

// ── evidence log ────────────────────────────────────────────────────────────
const evidence = []
let failures = 0
const record = (name, ok, detail) => {
  if (!ok) failures += 1
  evidence.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
}
const note = (name, detail) => {
  evidence.push({ name, ok: null, detail })
  console.log(`NOTE  ${name} — ${detail}`)
}

// ── the shipped console modules, loaded as they ship ────────────────────────
const nodeRequire = createRequire(import.meta.url)
const tsPaths = nodeRequire(
  resolve(repoRoot, 'tsconfig.base.json'),
).compilerOptions.paths
// jiti resolves aliases by prefix, so a wildcard entry keeps its trailing
// slash and an exact entry does not. Without that distinction the `@aglyn/
// aglyn/*` → `libs/aglyn/src/lib` mapping shadows the bare `@aglyn/aglyn`
// barrel and every import of it fails.
const alias = {}
for (const [key, [target]] of Object.entries(tsPaths)) {
  alias[key.replace(/\*$/, '')] = resolve(repoRoot, target.replace(/\*$/, ''))
}
const jiti = createJiti(import.meta.url, { alias, interopDefault: true })
const { STARTER_TEMPLATES, buildStarterTemplateDocs } = await jiti.import(
  resolve(repoRoot, 'apps/console/constants/starter-templates.ts'),
)
const { withBundleRootScreen, resolveTemplateSlug } = await jiti.import(
  resolve(repoRoot, 'apps/console/components/templates/create-page-from-template.ts'),
)
const { SCREEN_ROOT_PATH } = await jiti.import(
  resolve(repoRoot, 'libs/aglyn/src/lib/app-utils/screen-route.ts'),
)

// ── admin SDK against the emulator ──────────────────────────────────────────
if (!getApps().length) {
  initializeApp({ projectId: process.env.WIRE_PROJECT ?? 'aglyn-main' })
}
const db = getFirestore()
const runId = process.env.WIRE_RUN_ID ?? Date.now().toString(36)
const createdHostIds = []

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()

/**
 * Every distinctive string a screen's nodes put on the page, longest first.
 * Derived from the starter data rather than hardcoded, so a copy edit to a
 * starter cannot leave this harness asserting a marker that no longer ships
 * (which would fail loudly) or, worse, passing on a marker that appears on
 * every page.
 */
const contentMarkers = (nodes) => {
  const strings = []
  for (const node of Object.values(nodes ?? {})) {
    const children = node?.props?.children
    if (typeof children === 'string' && children.trim().length >= 12) {
      strings.push(children.trim())
    }
  }
  return strings.sort((a, b) => b.length - a.length)
}

/**
 * The apply loop, transcribed from `template-gallery-dialog`'s `handleUse`.
 * `screens` is whatever that dialog would hand it: the virtual starter's own
 * screen list, or the materialized library documents grouped by starter and
 * sorted into authored order.
 */
const planApply = (screens, existingSlugs) => {
  const used = new Set(existingSlugs)
  const plan = []
  for (const screen of withBundleRootScreen(screens, used)) {
    const { slug, requestedSlug } = resolveTemplateSlug({
      slug: screen.slug,
      displayName: screen.displayName,
      usedSlugs: used,
    })
    plan.push({
      displayName: screen.displayName,
      description: screen.description,
      seo: screen.seo,
      nodes: screen.nodes,
      slug,
      requestedSlug,
    })
  }
  return plan
}

/** The screens a MATERIALIZED starter presents, exactly as the gallery groups them. */
const materializedScreens = (starter) =>
  buildStarterTemplateDocs(starter)
    .slice()
    .sort(
      (a, b) =>
        Number(a.data.source?.starterOrder ?? 0) -
        Number(b.data.source?.starterOrder ?? 0),
    )
    .map((doc) => ({
      displayName: doc.data.displayName,
      description: doc.data.description,
      slug: doc.data.slug,
      seo: doc.data.seo,
      nodes: doc.data.nodes,
    }))

/** The screens a VIRTUAL starter presents, exactly as the gallery maps them. */
const virtualScreens = (starter) =>
  starter.screens.map((screen) => ({
    displayName: screen.displayName,
    description: screen.description,
    slug: screen.slug,
    seo: screen.seo,
    nodes: screen.nodes,
  }))

/**
 * Creates the scratch host and writes the pages the plan decided on.
 *
 * `screens: {}` is asserted on the way in — `/api/hosts/create` writes exactly
 * that, and a host that already had a root route would make every assertion
 * below pass for the wrong reason.
 */
const applyToScratchHost = async (hostId, plan) => {
  const hostRef = db.collection('hosts').doc(hostId)
  await hostRef.set({
    displayName: hostId,
    subdomain: hostId,
    orgId: ORG_ID,
    memberRoles: { [OWNER_UID]: 'owner' },
    screens: {},
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
  createdHostIds.push(hostId)
  const fresh = await hostRef.get()
  if (Object.keys(fresh.get('screens') ?? {}).length) {
    throw new Error(`${hostId} was not created with screens: {}`)
  }

  for (const page of plan) {
    const screenId = `agl1575-${randomUUID().slice(0, 12)}`
    const versionId = `${screenId}-v1`
    const screenRef = hostRef.collection('screens').doc(screenId)
    await screenRef.set({
      displayName: page.displayName,
      ...(page.description ? { description: page.description } : {}),
      ...(page.seo ? { seo: page.seo } : {}),
      versionId,
      slug: page.slug,
      publishedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    await screenRef.collection('versions').doc(versionId).set({
      screenId,
      displayName: 'Installed from template',
      nodes: page.nodes,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    // `publishScreenRoute`'s routing-map write. `path` defaults to `slug` for
    // a parent-less screen, and every screen in a starter is parent-less.
    await hostRef.update({ [`screens.${screenId}`]: page.slug })
    page.screenId = screenId
  }
  return (await hostRef.get()).get('screens') ?? {}
}

// ── build the cases ─────────────────────────────────────────────────────────
const cases = []
for (const starter of STARTER_TEMPLATES) {
  for (const [source, screens] of [
    ['virtual', virtualScreens(starter)],
    ['library', materializedScreens(starter)],
  ]) {
    cases.push({
      starterId: starter.id,
      starterName: starter.displayName,
      source,
      hostId: `agl1575-${starter.id}-${source}-${runId}`.toLowerCase(),
      screens,
    })
  }
}
note(
  'S0 starters under test',
  `${STARTER_TEMPLATES.length} starters × 2 apply sources = ${cases.length} ` +
    `scratch hosts: ${STARTER_TEMPLATES.map((s) => s.id).join(', ')}`,
)
record(
  'S1 the bar names FIVE starters and STARTER_TEMPLATES holds five',
  STARTER_TEMPLATES.length === 5,
  `${STARTER_TEMPLATES.length}: ${STARTER_TEMPLATES.map((s) => s.id).join(', ')}`,
)

// ── arrange, BEFORE the server boots ────────────────────────────────────────
// Ordering is load-bearing: `getHost` keeps a negative cache, so a host probed
// before it exists can keep 404ing for a host that is now perfectly valid.
for (const testCase of cases) {
  testCase.plan = planApply(testCase.screens, [])
  testCase.routes = await applyToScratchHost(testCase.hostId, testCase.plan)
  const root = testCase.plan.filter((page) => page.slug === SCREEN_ROOT_PATH)
  const paths = Object.values(testCase.routes)
  record(
    `S2 ${testCase.starterId} (${testCase.source}) publishes exactly one root route`,
    root.length === 1 &&
      paths.filter((p) => p === SCREEN_ROOT_PATH).length === 1 &&
      new Set(paths).size === paths.length,
    `routes ${JSON.stringify(paths)}; root page "${root[0]?.displayName}" ` +
      `(requested ${JSON.stringify(root[0]?.requestedSlug)})`,
  )
  testCase.rootPage = root[0]
  testCase.markers = contentMarkers(root[0]?.nodes)
}

// ── tenant production server ────────────────────────────────────────────────
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

const serverEnv = {
  ...parseEnvFile(join(repoRoot, 'apps/tenant/.env')),
  ...parseEnvFile(join(repoRoot, 'apps/tenant/.env.local')),
  ...process.env,
  FIREBASE_AUTH_EMULATOR_ENABLED: 'true',
  FIREBASE_FIRESTORE_EMULATOR_ENABLED: 'true',
  // AGL-1504: `preferRest` defeats the emulator's admin bypass and 404s every
  // page — which in THIS harness would look exactly like the bug under test.
  AGLYN_DISABLE_BOOT_WARMUP: '1',
  AGLYN_TENANT_DEMO: CONTROL_HOST,
  NEXT_TELEMETRY_DISABLED: '1',
}

if (process.env.WIRE_SKIP_BUILD !== '1') {
  console.log('building apps/tenant for production (uncached)…')
  const build = spawn(
    'npx',
    ['nx', 'build', 'tenant', '--configuration=production', '--skip-nx-cache'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: serverEnv },
  )
  let buildOutput = ''
  build.stdout.on('data', (c) => (buildOutput += String(c)))
  build.stderr.on('data', (c) => (buildOutput += String(c)))
  const code = await new Promise((r) => build.on('exit', r))
  if (code !== 0) {
    console.error('FAIL  tenant production build failed')
    console.error(buildOutput.split('\n').slice(-25).join('\n'))
    process.exit(1)
  }
}

console.log(`starting the tenant production server on ${PORT}…`)
const server = spawn(
  'npx',
  ['next', 'start', 'dist/apps/tenant', '-p', String(PORT)],
  {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: serverEnv,
  },
)
let serverOutput = ''
server.stdout.on('data', (c) => (serverOutput += String(c)))
server.stderr.on('data', (c) => (serverOutput += String(c)))
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}
process.on('exit', stopServer)
process.on('SIGINT', () => process.exit(130))

const deadline = Date.now() + BOOT_BUDGET_MS
let booted = false
while (Date.now() < deadline) {
  if (server.exitCode !== null) break
  try {
    await fetch(`http://${BASE_HOSTNAME}:${PORT}/home`, {
      signal: AbortSignal.timeout(5000),
    })
    booted = true
    break
  } catch {
    await wait(2000)
  }
}
if (!booted) {
  console.error('FAIL  tenant server never came up')
  console.error(serverOutput.split('\n').slice(-25).join('\n'))
  process.exit(1)
}

// ── probes ──────────────────────────────────────────────────────────────────
/**
 * One GET at a tenant's own address. `redirect: 'manual'` on purpose: the
 * 307-to-app.aglyn.com the port trap produces must be VISIBLE as a 307, not
 * followed into a body from another origin that would then fail a marker
 * assertion for a completely unrelated reason.
 */
const getTenant = async (hostId, path, query = '') => {
  const url = `http://${hostId}.${BASE_HOSTNAME}:${PORT}${path}${query}`
  // Addressed by NAME, so the Host header the middleware switches on is the
  // real subdomain. Do not be tempted to dial 127.0.0.1 with a hand-set
  // `host` header instead: `fetch` silently drops it, every request then
  // arrives as `127.0.0.1:4500`, and the middleware treats that as an unknown
  // custom domain and 307s the lot to app.aglyn.com — the port trap's exact
  // signature, reached by a different road.
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  })
  const body = await res.text()
  return { url, status: res.status, body, headers: res.headers }
}

console.log('\n=== A. CONTROLS (can this harness see a failure at all?) ===')
{
  // The pre-fix shape, still live in the seed: `demo`'s routing map is
  // {home, survey, scoped} with no `/`, so its ROOT 404s while `/home` serves.
  // That is precisely what a template-started site did before `a40d3efa4`, and
  // it is the control that stops a green run below from being a harness that
  // answers 200 to everything.
  const root = await getTenant(CONTROL_HOST, '/')
  const home = await getTenant(CONTROL_HOST, '/home')
  record(
    'A1 control: the seeded demo host has no "/" route and 404s at its root',
    root.status === 404 && home.status === 200,
    `GET / → HTTP ${root.status}; GET /home → HTTP ${home.status} ` +
      `(this is the AGL-1575 symptom, reproduced live)`,
  )
  record(
    'A2 control: the 307 port trap is not firing',
    root.status !== 307 && home.status !== 307,
    `no redirect to app.aglyn.com — the tenant is on :${PORT} and the ` +
      `middleware recognises it (location: ${home.headers.get('location')})`,
  )
}

console.log('\n=== B. THE BAR: every starter serves at its site root ===')
for (const testCase of cases) {
  const label = `${testCase.starterId} (${testCase.source})`
  // Bare path AND a cache-buster. A tenant route is ISR-cached (`revalidate =
  // 60`), and a bare path can serve an old render for minutes; a query string
  // is a different cache key. These hosts are new this run so nothing stale
  // CAN exist for them — asserting both is what turns that from a belief into
  // an observation.
  const bare = await getTenant(testCase.hostId, '/')
  const busted = await getTenant(testCase.hostId, '/', `?cb=${randomUUID()}`)
  const marker = testCase.markers.find((m) => bare.body.includes(m))
  const bustedMarker = testCase.markers.find((m) => busted.body.includes(m))
  record(
    `B1 ${label} → site root serves its starter content`,
    bare.status === 200 &&
      busted.status === 200 &&
      Boolean(marker) &&
      marker === bustedMarker,
    `GET ${bare.url} → HTTP ${bare.status}${
      marker ? ` with "${marker.slice(0, 48)}"` : ' with NO starter marker'
    }; cache-busted → HTTP ${busted.status}${
      bustedMarker ? ' (same marker)' : ' with NO starter marker'
    }; ${bare.body.length} bytes`,
  )
  testCase.rootStatus = bare.status
  testCase.rootMarker = marker ?? null
  testCase.rootBytes = bare.body.length

  // Every OTHER page the starter published must serve too — a starter that
  // wins the root by breaking its own second page has not passed anything.
  const others = testCase.plan.filter((p) => p.slug !== SCREEN_ROOT_PATH)
  if (others.length) {
    const results = []
    for (const page of others) {
      const res = await getTenant(testCase.hostId, `/${page.slug}`)
      results.push(`${page.slug}:${res.status}`)
    }
    record(
      `B2 ${label} → its ${others.length} non-root page(s) serve too`,
      results.every((r) => r.endsWith(':200')),
      results.join(', '),
    )
  }

  // The other half of a routing proof: a path the starter did NOT publish must
  // still 404. Without this, "200 at the root" could be a tenant that answers
  // 200 for anything.
  const absent = await getTenant(testCase.hostId, '/agl1575-no-such-page')
  record(
    `B3 ${label} → an unpublished path still 404s`,
    absent.status === 404,
    `HTTP ${absent.status}`,
  )
}

console.log('\n=== C. PRE-FIX CONTROL: the same starters BEFORE a40d3efa4 ===')
// The gap AGL-1575's implementing agent recorded honestly and left open: the
// 404 was never reproduced, because rolling the working tree back in a shared
// checkout would have taken other sessions' dirty files with it. It does not
// have to be rolled back. `a40d3efa4^` is readable with `git show`, and the
// two modules that decide a template page's address are extracted to a
// throwaway tree under tmp/ (mirroring their repo depth so their relative
// imports still resolve) and imported there. Nothing in the working tree moves.
//
// Section B without this section is a run in which every probe answers 200,
// and a harness that cannot fail is not evidence.
{
  const preRoot = join(repoRoot, 'tmp', 'agl1575-prefix')
  const files = [
    'apps/console/constants/starter-templates.ts',
    'apps/console/constants/screen-publishing.ts',
    'apps/console/components/templates/create-page-from-template.ts',
  ]
  for (const relative of files) {
    const target = join(preRoot, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(
      target,
      execFileSync('git', ['show', `a40d3efa4^:${relative}`], {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
      }),
    )
  }
  const pre = await jiti.import(join(preRoot, files[0]))
  const preApply = await jiti.import(join(preRoot, files[2]))

  // The pre-fix resolution, transcribed from `createPageFromTemplate` at
  // `a40d3efa4^` — where it was inline in the async function rather than an
  // extractable helper, so this is the only way to exercise it without a live
  // client Firestore. Verbatim:
  //
  //   const base =
  //     slugifyPageName(input.slug ?? '') || slugifyPageName(displayName) || 'page'
  //   let slug = base
  //   let attempt = 2
  //   while (usedSlugs.has(slug)) slug = `${base}-${attempt++}`
  //   usedSlugs.add(slug)
  //
  // `slugifyPageName` itself is imported, not copied: it is the function that
  // reduced both `''` and `'/'` to the empty string, and it is the defect.
  const prePlan = (screens) => {
    const usedSlugs = new Set()
    return screens.map((screen) => {
      const base =
        preApply.slugifyPageName(screen.slug ?? '') ||
        preApply.slugifyPageName(screen.displayName) ||
        'page'
      let slug = base
      let attempt = 2
      while (usedSlugs.has(slug)) slug = `${base}-${attempt++}`
      usedSlugs.add(slug)
      return { ...screen, slug, requestedSlug: screen.slug }
    })
  }

  for (const starter of pre.STARTER_TEMPLATES) {
    const hostId = `agl1575-pre-${starter.id}-${runId}`.toLowerCase()
    const plan = prePlan(
      starter.screens.map((screen) => ({
        displayName: screen.displayName,
        description: screen.description,
        slug: screen.slug,
        seo: screen.seo,
        nodes: screen.nodes,
      })),
    )
    const routes = await applyToScratchHost(hostId, plan)
    const paths = Object.values(routes)
    const root = await getTenant(hostId, '/')
    const landed = await getTenant(hostId, `/${plan[0].slug}`)
    record(
      `C1 pre-fix ${starter.id} → the site root 404s (the reported bug)`,
      root.status === 404 &&
        !paths.includes(SCREEN_ROOT_PATH) &&
        landed.status === 200,
      `routes ${JSON.stringify(paths)}; GET / → HTTP ${root.status}; the home ` +
        `page landed at /${plan[0].slug} → HTTP ${landed.status}`,
    )
  }
  // The pre-fix seed layer, the second defect the issue did not describe: a
  // root slug spelled `''` was dropped by `...(screen.slug ? {slug} : {})`, so
  // a materialized shop starter had no field left saying which screen is home.
  const preShop = pre.STARTER_TEMPLATES.find((s) => s.id === 'physical-shop')
  const preDocs = pre.buildStarterTemplateDocs(preShop)
  record(
    'C2 pre-fix buildStarterTemplateDocs discarded the shop home slug',
    !('slug' in preDocs[0].data) && preShop.screens[0].slug === '',
    `authored slug ${JSON.stringify(preShop.screens[0].slug)} → seeded doc ` +
      `keys ${JSON.stringify(Object.keys(preDocs[0].data))}`,
  )
  const nowShop = STARTER_TEMPLATES.find((s) => s.id === 'physical-shop')
  const nowDocs = buildStarterTemplateDocs(nowShop)
  record(
    'C3 …and today it carries the root through',
    nowDocs[0].data.slug === SCREEN_ROOT_PATH,
    `authored slug ${JSON.stringify(nowShop.screens[0].slug)} → seeded doc ` +
      `slug ${JSON.stringify(nowDocs[0].data.slug)}`,
  )
}

// ── teardown + report ───────────────────────────────────────────────────────
stopServer()
if (process.env.WIRE_KEEP !== '1') {
  for (const hostId of createdHostIds) {
    const hostRef = db.collection('hosts').doc(hostId)
    const screens = await hostRef.collection('screens').listDocuments()
    for (const screenRef of screens) {
      const versions = await screenRef.collection('versions').listDocuments()
      for (const versionRef of versions) await versionRef.delete()
      await screenRef.delete()
    }
    await hostRef.delete()
  }
  note('Z teardown', `${createdHostIds.length} scratch hosts deleted`)
} else {
  note('Z teardown SKIPPED', `WIRE_KEEP=1 — left ${createdHostIds.join(', ')}`)
}

const artifactsDir = join(repoRoot, 'tmp')
try {
  mkdirSync(artifactsDir, { recursive: true })
  writeFileSync(
    join(artifactsDir, 'starter-root-wire.json'),
    JSON.stringify(
      {
        at: nowIso(),
        runId,
        port: PORT,
        cases: cases.map((c) => ({
          starterId: c.starterId,
          source: c.source,
          hostId: c.hostId,
          routes: c.routes,
          rootStatus: c.rootStatus,
          rootMarker: c.rootMarker,
          rootBytes: c.rootBytes,
        })),
        evidence,
      },
      null,
      2,
    ),
  )
} catch {
  /* artifacts are a convenience, not the gate */
}

console.log(
  failures
    ? `\n${failures} assertion(s) FAILED on the wire`
    : '\nstarter templates: every site root observed serving on the wire',
)
process.exit(failures ? 1 : 0)
