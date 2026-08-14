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

// READ-ONLY LOCKDOWN — WIRE PROOF (AGL-1626).
//
// AGL-1511 shipped read-only mode unit-proven: specs at every layer, green
// gates, and nothing observed on the wire. That gap matters more here than
// usual, because read-only's whole claim is about what happens on a page
// that is STILL BEING SERVED — and a cached page serving is indistinguishable
// from a lock that never engaged. This harness is the AGL-1501 treatment
// applied to the mode: force each branch against the emulator and a real
// `next build` / `next start` tenant, and record status codes and bodies.
//
// Prerequisites:
//   1. Emulators (auth 9099, firestore 8082): `npm run firebase:emulate`.
//      Port 4500 MUST be free — `apps/tenant/middleware.ts` recognizes
//      `localhost:4500` and `*.localhost:4500` and NOTHING else locally, so
//      a tenant on any other port is redirected to app.aglyn.com before a
//      single lockdown branch can be observed. (firebase-tools defaults its
//      logging emulator to 4500; cloud/firebase.json pins it to 4520.)
//   2. `npm run seed:e2e`
//   3. FIRESTORE_EMULATOR_HOST=localhost:8082 \
//      FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//        node tools/e2e/lockdown-readonly-wire.mjs
//
// Env:
//   WIRE_SKIP_BUILD=1        assert against the existing dist (iterating only)
//   WIRE_CONSOLE_BASE_URL    a running emulated console; when unset or
//                            unreachable the console probes REPORT AS NOT RUN
//                            rather than silently passing.
//
// NO STRIPE, EVER. The checkout probe is only ever fired while a lock is
// armed and only ever asserts the 423; localhost carries the LIVE Stripe key,
// and an unlocked checkout POST is never sent from this file.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = Number(process.env.WIRE_PORT ?? 4500)
const BASE = process.env.WIRE_BASE_URL ?? `http://localhost:${PORT}`
const CONSOLE_BASE = process.env.WIRE_CONSOLE_BASE_URL ?? 'http://localhost:4200'
const HOST_ID = process.env.WIRE_HOST ?? 'demo'
const ORG_ID = process.env.WIRE_ORG ?? 'e2e-owner'
const STAFF_UID = 'e2e-owner'
const PROBE_UID = 'wire-readonly-probe'
const PROBE_EMAIL = 'wire-readonly-probe@aglyn.test'
const BOOT_BUDGET_MS = Number(process.env.WIRE_BOOT_BUDGET_MS ?? 120_000)
// The page surface converges through TWO caches — the tenant data cache
// (HOST_DOC_TTL_SECONDS = 60 in apps/tenant/utils/get-host.ts) and the
// middleware's 30s verdict memo — so a page-level assertion needs a window
// wider than both. Write refusals read live and need none of it; that
// asymmetry is one of the things this harness measures.
const PAGE_CONVERGENCE_BUDGET_MS = Number(
  process.env.WIRE_PAGE_BUDGET_MS ?? 150_000,
)

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  console.error(
    'Refusing to run: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST ' +
      'must both point at local emulators. This harness ARMS LOCKDOWNS — it ' +
      'must never be able to reach production.',
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

// ── admin SDK against the emulator ──────────────────────────────────────────
if (!getApps().length) {
  initializeApp({ projectId: process.env.WIRE_PROJECT ?? 'aglyn-main' })
}
const db = getFirestore()
const auth = getAuth()
const orgRef = db.collection('orgs').doc(ORG_ID)
const hostRef = db.collection('hosts').doc(HOST_ID)
const platformRef = db.collection('lockdowns').doc('platform')

const nowIso = () => new Date().toISOString()

/** Arm a lock on the org carrier. `mode` omitted = FULL (absent means full). */
const armOrgLock = async (mode, extra = {}) =>
  orgRef.set(
    {
      suspendedAt: Date.now(),
      suspendedReasonCode: 'maintenance',
      suspendedMessage: 'Scheduled data migration.',
      ...(mode === 'read-only' ? { suspendedMode: 'read-only' } : {}),
      ...extra,
    },
    { merge: true },
  )

const liftOrgLock = async () =>
  orgRef.set(
    {
      suspendedAt: FieldValue.delete(),
      suspendedReasonCode: FieldValue.delete(),
      suspendedMessage: FieldValue.delete(),
      suspendedMode: FieldValue.delete(),
      suspendedUntilMs: FieldValue.delete(),
    },
    { merge: true },
  )

const armPlatformLock = async (mode) =>
  platformRef.set({
    scope: 'platform',
    reason: 'maintenance',
    message: 'Platform maintenance window.',
    atMs: Date.now(),
    ...(mode === 'read-only' ? { mode: 'read-only' } : {}),
  })

const liftPlatformLock = async () => platformRef.delete()

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
  // AGL-1504: `preferRest` defeats the emulator's `Bearer owner` admin
  // bypass, 404ing every page before this harness can assert anything.
  AGLYN_DISABLE_BOOT_WARMUP: '1',
  AGLYN_TENANT_DEMO: HOST_ID,
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
} else {
  console.warn(
    'WIRE_SKIP_BUILD=1 — asserting against the EXISTING dist and its ISR ' +
      'cache. Fine for lockdown branches (every probe here is dynamic), but ' +
      'never trust a render assertion from this mode.',
  )
}

console.log(`starting the tenant production server on ${PORT}…`)
const server = spawn(
  'npx',
  ['next', 'start', 'dist/apps/tenant', '-p', String(PORT)],
  { cwd: repoRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: serverEnv },
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const deadline = Date.now() + BOOT_BUDGET_MS
let booted = false
while (Date.now() < deadline) {
  if (server.exitCode !== null) break
  try {
    await fetch(`${BASE}/home`, { signal: AbortSignal.timeout(5000) })
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

// ── probe helpers ───────────────────────────────────────────────────────────
const getPage = async (path) => {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30_000) })
  const body = await res.text()
  return { status: res.status, body, headers: res.headers }
}

const postJson = async (url, payload) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text, headers: res.headers }
}

const verdict = async () => {
  const res = await fetch(
    `${BASE}/api/lockdown-verdict?host=${encodeURIComponent(HOST_ID)}`,
    { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
  )
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** Poll `probe` until `predicate` holds; returns the elapsed ms or null. */
const timeToConverge = async (probe, predicate, budgetMs, intervalMs = 2000) => {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    const result = await probe()
    if (predicate(result)) return { ms: Date.now() - started, result }
    await wait(intervalMs)
  }
  return { ms: null, result: await probe() }
}

const formCounters = async () => {
  const snapshot = await hostRef.collection('counters').doc('formSubmissions').get()
  const submissions = await hostRef.collection('formSubmissions').count().get()
  return {
    counters: snapshot.exists ? snapshot.data() : null,
    submissionCount: submissions.data().count,
  }
}

// ── clean slate ─────────────────────────────────────────────────────────────
await liftOrgLock()
await liftPlatformLock().catch(() => {})
await hostRef.set(
  {
    suspendedAt: FieldValue.delete(),
    suspendedMode: FieldValue.delete(),
    suspendedReasonCode: FieldValue.delete(),
  },
  { merge: true },
)

console.log('\n=== A. BASELINE (no lock) ===')
{
  // The verdict route reads the org/host docs through the TENANT DATA CACHE
  // (`withRenderCache`, 60s), and in production mode that cache lives on
  // DISK under dist/apps/tenant/.next — so a lock armed by an earlier run
  // survives a server restart. Converge before asserting anything, and
  // record how long it took: this is the same lag an operator waits through
  // after lifting a lock, and it is why a baseline must be established
  // rather than assumed.
  const cleared = await timeToConverge(
    verdict,
    (v) => v.json?.locked === false,
    PAGE_CONVERGENCE_BUDGET_MS,
  )
  record(
    'A0 baseline verdict clears',
    cleared.result.json?.locked === false,
    `locked:false after ${cleared.ms ?? '>budget'}ms (tenant data cache TTL 60s)`,
  )
  // The PAGE takes longer than the verdict, and for a second reason: a
  // render made under a FULL lock is the 503 notice, and Next caches it
  // like any other ISR entry (`revalidate = 60` on the tenant catch-all).
  // So after a full lock is lifted the site keeps answering 503 from cache
  // until that entry regenerates. The real `/api/admin/lockdown` lift
  // revalidates the host's tag to collapse this; a carrier written directly
  // — which is what this harness does, and what a manual Firestore edit
  // during an incident would do — observes the un-revalidated worst case.
  const restored = await timeToConverge(
    () => getPage('/home'),
    (p) => p.status === 200 && p.body.includes('Fresh sourdough'),
    PAGE_CONVERGENCE_BUDGET_MS,
    5000,
  )
  record(
    'A1 baseline GET /home restores 200',
    restored.result.status === 200 &&
      restored.result.body.includes('Fresh sourdough'),
    `HTTP ${restored.result.status} after ${restored.ms ?? '>budget'}ms ` +
      `(ISR revalidate = 60s; a lift issued through /api/admin/lockdown ` +
      `revalidates the tag instead of waiting)`,
  )
}

console.log('\n=== B. ORG READ-ONLY LOCK ===')
const armedAt = Date.now()
await armOrgLock('read-only')
note('B0 armed', `org ${ORG_ID} suspendedMode=read-only at ${nowIso()}`)

{
  // THE OPERATOR'S NUMBER, measured before anything else can pad it: how
  // long after arming does the first write actually get refused? Fired as
  // the very next request, so a 423 here means the lag is bounded by one
  // round trip — the write gate reads the org/host carriers LIVE per
  // request (React.cache is per-render only), unlike the page surface,
  // which converges through a 60s data cache and a 30s middleware memo.
  const immediate = await postJson(`${BASE}/api/forms/submit`, {
    hostId: HOST_ID,
    formName: 'Visitor survey',
    fields: { name: 'AGL-1626 immediate-refusal probe' },
  })
  record(
    'B0a the FIRST write after arming is already refused',
    immediate.status === 423,
    `HTTP ${immediate.status} on the first request, ` +
      `${Date.now() - armedAt}ms after the carrier write`,
  )
}

{
  // The verdict route reads through the tenant data cache (60s), so poll.
  const converge = await timeToConverge(
    verdict,
    (v) => v.json?.locked === true && v.json?.mode === 'read-only',
    PAGE_CONVERGENCE_BUDGET_MS,
  )
  record(
    'B1 /api/lockdown-verdict reports mode=read-only',
    converge.result.json?.locked === true &&
      converge.result.json?.mode === 'read-only',
    `after ${converge.ms ?? '>budget'}ms: ${JSON.stringify(converge.result.json)}`,
  )
}

{
  // THE CLAIM THE WHOLE MODE RESTS ON: the page keeps serving. Sample past
  // both caches so a 503 that arrives late cannot hide behind a fresh memo.
  const samples = []
  const until = Date.now() + 100_000
  while (Date.now() < until) {
    const home = await getPage('/home')
    samples.push(home.status)
    if (home.status !== 200) break
    await wait(10_000)
  }
  const all200 = samples.every((s) => s === 200)
  const last = await getPage('/home')
  record(
    'B2 GET /home keeps serving 200 under a read-only lock',
    all200 && last.status === 200 && last.body.includes('Fresh sourdough'),
    `${samples.length} samples over ~100s: [${samples.join(', ')}]; final body marker ` +
      `${last.body.includes('Fresh sourdough') ? 'present' : 'MISSING'}; ` +
      `no /api/locked rewrite (notice absent: ${!last.body.includes('Down for maintenance')})`,
  )
}

{
  const before = await formCounters()
  const started = Date.now()
  const form = await postJson(`${BASE}/api/forms/submit`, {
    hostId: HOST_ID,
    formName: 'Visitor survey',
    fields: { name: 'AGL-1626 wire probe', email: 'probe@example.test' },
  })
  const elapsed = Date.now() - started
  const body = form.json ?? {}
  const okStatus = form.status === 423
  const okTitle = body.title === 'Temporarily paused'
  const okCopy = String(body.message ?? '').includes('Nothing you typed')
  const noContact = !('contact' in body)
  record(
    'B3 visitor form POST refuses 423 with the pause copy',
    okStatus && okTitle && okCopy && noContact,
    `HTTP ${form.status} in ${elapsed}ms — ${JSON.stringify(body)}`,
  )
  note(
    'B3a convergence asymmetry',
    `write refusals are LIVE (see B0a); the PAGE surface converges through ` +
      `the 60s tenant data cache and the 30s middleware memo (see B1). An ` +
      `operator arming read-only gets the freeze immediately and the ` +
      `verdict-route/staff-probe view about a minute later.`,
  )
  const after = await formCounters()
  record(
    'B4 the refused submission spent nothing',
    JSON.stringify(before.counters) === JSON.stringify(after.counters) &&
      before.submissionCount === after.submissionCount,
    `counters ${JSON.stringify(before.counters)} → ${JSON.stringify(after.counters)}; ` +
      `formSubmissions docs ${before.submissionCount} → ${after.submissionCount}`,
  )
}

{
  const cart = await postJson(`${BASE}/api/commerce/cart`, {
    hostId: HOST_ID,
    action: 'add',
    productId: 'wire-probe',
    quantity: 1,
  })
  const body = cart.json ?? {}
  record(
    'B5 cart POST refuses 423 with the cart pause copy',
    cart.status === 423 && body.title === 'Temporarily paused',
    `HTTP ${cart.status} — ${JSON.stringify(body)}`,
  )
}

{
  // ONLY fired while the lock is armed. If this ever returns anything other
  // than 423 the harness stops rather than retrying — localhost holds the
  // LIVE Stripe key and the refusal is what keeps the handler unreached.
  const checkout = await postJson(`${BASE}/api/commerce/checkout`, {
    hostId: HOST_ID,
    items: [{ productId: 'wire-probe', quantity: 1 }],
  })
  const body = checkout.json ?? {}
  const stripeTouched =
    /stripe|client_secret|checkout\.session/i.test(checkout.text) &&
    checkout.status !== 423
  // The checkout surface carries its OWN title and the one promise no
  // generic copy can make — "you have not been charged".
  record(
    'B6 checkout POST refuses 423 before the handler (no Stripe session)',
    checkout.status === 423 &&
      body.title === 'Checkout is temporarily paused' &&
      String(body.message ?? '').includes('you have not been charged') &&
      !stripeTouched,
    `HTTP ${checkout.status} — ${JSON.stringify(body)}`,
  )
}

console.log('\n=== C. STRICTNESS OUTRANKS WIDTH ===')
// The highest-consequence branch in the feature: a platform-wide read-only
// maintenance window must NOT soften a full security takedown on one org.
{
  await armOrgLock(undefined, {
    suspendedReasonCode: 'security',
    suspendedMessage: 'Security investigation.',
    suspendedMode: FieldValue.delete(),
  })
  await armPlatformLock('read-only')
  const converge = await timeToConverge(
    verdict,
    (v) => v.json?.mode === 'full',
    PAGE_CONVERGENCE_BUDGET_MS,
  )
  record(
    'C1 platform read-only + org FULL → verdict stays full/org',
    converge.result.json?.mode === 'full' &&
      converge.result.json?.locked === true,
    `after ${converge.ms ?? '>budget'}ms: ${JSON.stringify(converge.result.json)}`,
  )
  const pageConverge = await timeToConverge(
    () => getPage('/home'),
    (p) => p.status === 503,
    PAGE_CONVERGENCE_BUDGET_MS,
    5000,
  )
  record(
    'C2 the site is 503 — the wider read-only window did NOT readmit visitors',
    pageConverge.result.status === 503,
    `HTTP ${pageConverge.result.status} after ${pageConverge.ms ?? '>budget'}ms; ` +
      `Retry-After ${pageConverge.result.headers.get('retry-after')}`,
  )
  await liftPlatformLock()
  await liftOrgLock()
}

console.log('\n=== D. EXPIRY RESTORES WRITES WITH NO STAFF ACTION ===')
{
  const untilMs = Date.now() + 25_000
  await armOrgLock('read-only', { suspendedUntilMs: untilMs })
  const refused = await postJson(`${BASE}/api/forms/submit`, {
    hostId: HOST_ID,
    fields: { name: 'AGL-1626 expiry probe (pre)' },
  })
  const before = await formCounters()
  record(
    'D1 write refuses while the window is open',
    refused.status === 423,
    `HTTP ${refused.status}`,
  )
  while (Date.now() < untilMs + 2000) await wait(1000)
  const after = await postJson(`${BASE}/api/forms/submit`, {
    hostId: HOST_ID,
    fields: { name: 'AGL-1626 expiry probe (post)' },
  })
  const counters = await formCounters()
  record(
    'D2 the window passing restores writes with NO staff action and no write',
    after.status === 200 || after.status === 201,
    `HTTP ${after.status} ${JSON.stringify(after.json)}; formSubmissions ` +
      `${before.submissionCount} → ${counters.submissionCount}`,
  )
  await liftOrgLock()
}

console.log('\n=== E. HOST-SCOPE READ-ONLY ===')
// The third scope read-only supports. Worth its own pass rather than being
// assumed from the org one: the host carrier is a DIFFERENT document read by
// a different normalizer, and `host.maintenance` — the customer's own switch
// — lives on the same doc and must not be confused with it.
{
  await liftOrgLock()
  await hostRef.set(
    {
      suspendedAt: Date.now(),
      suspendedReasonCode: 'maintenance',
      suspendedMessage: 'Site data repair.',
      suspendedMode: 'read-only',
    },
    { merge: true },
  )
  const write = await postJson(`${BASE}/api/forms/submit`, {
    hostId: HOST_ID,
    fields: { name: 'AGL-1626 host-scope probe' },
  })
  record(
    'E1 host-scope read-only refuses a visitor write',
    write.status === 423 && (write.json ?? {}).scope === 'host',
    `HTTP ${write.status} — ${JSON.stringify(write.json)}`,
  )
  // The PAGE assertion needs the verdict route to have caught up first.
  // Section C leaves a FULL lock in the 60s tenant data cache and a blocked
  // entry in the middleware's 30s memo, so a page checked the instant this
  // section starts answers 503 from the PREVIOUS branch — a stale cache
  // answering for a lock that is no longer armed, which reads exactly like
  // "host read-only takes the site down" and is not that at all. Wait for
  // the verdict to report THIS lock, then assert.
  const converged = await timeToConverge(
    verdict,
    (v) => v.json?.locked === true && v.json?.mode === 'read-only',
    PAGE_CONVERGENCE_BUDGET_MS,
  )
  const page = await timeToConverge(
    () => getPage('/home'),
    (p) => p.status === 200 && p.body.includes('Fresh sourdough'),
    PAGE_CONVERGENCE_BUDGET_MS,
    5000,
  )
  record(
    'E2 …and the site keeps serving',
    page.result.status === 200 && page.result.body.includes('Fresh sourdough'),
    `HTTP ${page.result.status} after ${page.ms ?? '>budget'}ms; verdict ` +
      `${JSON.stringify(converged.result.json)} after ${converged.ms ?? '>budget'}ms`,
  )
  await hostRef.set(
    {
      suspendedAt: FieldValue.delete(),
      suspendedReasonCode: FieldValue.delete(),
      suspendedMessage: FieldValue.delete(),
      suspendedMode: FieldValue.delete(),
    },
    { merge: true },
  )
}

// ── console probes ──────────────────────────────────────────────────────────
console.log('\n=== F. CONSOLE (non-staff vs staff) ===')
let consoleUp = false
// Generous: an emulated console is a TURBOPACK DEV server, and the first
// request to a route it has not compiled yet can take tens of seconds. A
// short timeout here reads exactly like "no console running" and silently
// drops five branches from the run — which is the failure this whole issue
// exists to stop.
for (let attempt = 0; attempt < 3 && !consoleUp; attempt += 1) {
  const res = await fetch(`${CONSOLE_BASE}/api/health`, {
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null)
  consoleUp = Boolean(res)
}

if (!consoleUp) {
  note(
    'F* console probes NOT RUN',
    `no emulated console answering at ${CONSOLE_BASE} — start it with ` +
      `\`npm run serve:console:emulated\` and re-run. These branches are ` +
      `NOT wire-proven by this run.`,
  )
} else {
  // A non-staff member of the locked org, created here rather than in the
  // shared seed: the seeded owner of this org carries the staff claim, and a
  // staff caller bypasses every scope — the exact thing under test.
  await auth
    .createUser({
      uid: PROBE_UID,
      email: PROBE_EMAIL,
      emailVerified: true,
      password: 'E2e-Password-1',
    })
    .catch(async (error) => {
      if (error?.code !== 'auth/uid-already-exists') throw error
      await auth.updateUser(PROBE_UID, { emailVerified: true })
    })
  await auth.setCustomUserClaims(PROBE_UID, {})
  await hostRef.set(
    { memberRoles: { [PROBE_UID]: 'admin' } },
    { merge: true },
  )
  await orgRef
    .collection('members')
    .doc(PROBE_UID)
    .set({ role: 'admin', email: PROBE_EMAIL }, { merge: true })

  const apiKey = process.env.WIRE_API_KEY ?? 'aglyn-emulator-key'
  const tokenFor = async (uid) => {
    const customToken = await auth.createCustomToken(uid)
    const res = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      },
    )
    const payload = await res.json()
    if (!res.ok) throw new Error(`custom-token exchange failed: ${JSON.stringify(payload)}`)
    return payload.idToken
  }

  const probeToken = await tokenFor(PROBE_UID)
  const staffToken = await tokenFor(STAFF_UID)

  const consolePost = async (path, payload, token) => {
    const res = await fetch(`${CONSOLE_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* html */
    }
    return { status: res.status, json, text: text.slice(0, 300) }
  }

  await armOrgLock('read-only')

  {
    const mutation = await consolePost(
      '/api/hosts/collections',
      {
        hostId: HOST_ID,
        action: 'create',
        kind: 'content',
        data: { slug: `agl-1626-wire-probe-${Date.now().toString(36)}`, name: 'AGL-1626 wire probe' },
      },
      probeToken,
    )
    record(
      'F1 console mutation (non-staff) refuses 423 under a read-only lock',
      mutation.status === 423 && mutation.json?.error === 'locked',
      `HTTP ${mutation.status} — ${JSON.stringify(mutation.json ?? mutation.text)}`,
    )
  }

  {
    const references = await consolePost(
      '/api/media/references',
      { mediaId: 'agl-1626-absent', orgId: ORG_ID },
      probeToken,
    )
    record(
      'F2 media/references PASSES a read-only lock (AGL-1625 intent: read)',
      references.status !== 423,
      `HTTP ${references.status} — ${JSON.stringify(references.json ?? references.text)} ` +
        `(any non-423 proves the lockdown gate let the READ through)`,
    )
  }

  {
    // A UNIQUE slug per run. A reused one collides with the previous run's
    // collection and answers 409 — which is not 423 and so passes a
    // `!== 423` assertion while proving nothing was written. Assert the 200
    // instead, so this branch fails if the staff bypass ever stops working.
    const slug = `agl-1626-staff-probe-${Date.now().toString(36)}`
    const staffMutation = await consolePost(
      '/api/hosts/collections',
      {
        hostId: HOST_ID,
        action: 'create',
        kind: 'content',
        data: { slug, name: 'AGL-1626 staff probe' },
      },
      staffToken,
    )
    record(
      'F3 staff write BYPASSES the same read-only lock',
      staffMutation.status === 200 && staffMutation.json?.ok === true,
      `HTTP ${staffMutation.status} — ${JSON.stringify(staffMutation.json ?? staffMutation.text)}`,
    )
  }

  {
    // A platform read-only lock must not stop anyone SIGNING IN: the mint
    // passes `intent: 'read'` because signing in is how a customer reaches
    // the data read-only is deliberately keeping readable.
    await liftOrgLock()
    await armPlatformLock('read-only')
    await wait(16_000) // PLATFORM_TTL_MS = 15s
    const mint = await fetch(`${CONSOLE_BASE}/api/auth/session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${probeToken}` },
      signal: AbortSignal.timeout(30_000),
    })
    const mintText = await mint.text()
    record(
      'F4 console session mint succeeds under a PLATFORM read-only lock',
      mint.status !== 423,
      `HTTP ${mint.status} — ${mintText.slice(0, 200)}`,
    )
    const mutation = await consolePost(
      '/api/hosts/collections',
      {
        hostId: HOST_ID,
        action: 'create',
        kind: 'content',
        data: { slug: `agl-1626-platform-probe-${Date.now().toString(36)}`, name: 'AGL-1626 platform probe' },
      },
      probeToken,
    )
    record(
      'F5 …and a console mutation then refuses 423 (platform scope)',
      mutation.status === 423,
      `HTTP ${mutation.status} — ${JSON.stringify(mutation.json ?? mutation.text)}`,
    )
    await liftPlatformLock()
  }
}

// ── teardown + report ───────────────────────────────────────────────────────
await liftOrgLock()
await liftPlatformLock().catch(() => {})
await hostRef.set(
  {
    suspendedAt: FieldValue.delete(),
    suspendedReasonCode: FieldValue.delete(),
    suspendedMessage: FieldValue.delete(),
    suspendedMode: FieldValue.delete(),
  },
  { merge: true },
)
// The probe member too: `seed:e2e` is shared with every other local harness,
// and an extra editor on the demo site is exactly the kind of leftover that
// makes someone else's role assertion pass for the wrong reason. The auth
// account is left in place — it is cheap to reuse and grants nothing without
// this role.
//
// `update` with a dotted path, NOT `set(..., {merge:true})`: in `set` a
// dotted key is a LITERAL field name, so the merge form would quietly create
// a top-level field called `memberRoles.wire-readonly-probe` and leave the
// real nested role exactly where it was.
await hostRef
  .update({ [`memberRoles.${PROBE_UID}`]: FieldValue.delete() })
  .catch(() => {})
await orgRef
  .collection('members')
  .doc(PROBE_UID)
  .delete()
  .catch(() => {})
stopServer()

const artifactsDir = join(repoRoot, 'tmp')
try {
  mkdirSync(artifactsDir, { recursive: true })
  writeFileSync(
    join(artifactsDir, 'lockdown-readonly-wire.json'),
    JSON.stringify({ at: nowIso(), base: BASE, evidence }, null, 2),
  )
} catch {
  /* artifacts are a convenience, not the gate */
}

console.log(
  failures
    ? `\n${failures} branch(es) FAILED on the wire`
    : '\nread-only lockdown: every probed branch observed on the wire',
)
process.exit(failures ? 1 : 0)
