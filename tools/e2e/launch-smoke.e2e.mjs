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

// The launch smoke (AGL-1514): the whole path a first customer walks —
// SIGN UP → ORG → HOST → PUBLISH → served on the `*.aglyn.app` equivalent —
// against the local Firebase emulators, with a deliberate failure beside
// every assertion.
//
// Why the negatives are in the harness rather than in a runbook: a green
// check only proves what it reads. Each step here first breaks its own
// precondition and asserts the matching refusal, so a step that silently
// stopped enforcing anything goes red instead of staying green.
//
// Prerequisites (docs/E2E_LOCAL.md):
//   1. Emulators: cloud/ `npx -y firebase-tools@13 emulators:start
//      --config firebase.e2e.json --project aglyn-main --only auth,firestore`
//   2. A console dev server with the emulator flags (any port; default 4300).
//   3. A tenant server on port 4500 — the middleware's `*.localhost:4500`
//      case is the local stand-in for `*.aglyn.app`.
//
//   FIRESTORE_EMULATOR_HOST=localhost:8082 \
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//     node tools/e2e/launch-smoke.e2e.mjs
//
// It never touches production: like `seed-e2e.mjs` it refuses to run without
// both emulator host vars, and every write goes through the emulator.
//
// WHAT THE TENANT LEG DOES AND DOES NOT PROVE. The `*.localhost:4500`
// middleware branch is the same string-strip as the `.aglyn.app` branch one
// case above it, so host→site resolution is genuinely exercised. What is NOT
// exercised locally: Vercel's edge, wildcard DNS and wildcard TLS. Under
// `next dev` there is also no incremental cache at all, so the MISS/HIT pair
// only means anything against a production build (`next start dist/apps/
// tenant`); the harness reports which server it found and marks the cache
// assertions INCONCLUSIVE rather than passing them on a dev server.

import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp as initAdminApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { initializeApp as initClientApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  doc,
  getFirestore as getClientFirestore,
  setDoc,
} from 'firebase/firestore'
import { chromium } from 'playwright-core'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const CONSOLE_URL = process.env.SMOKE_CONSOLE_URL ?? 'http://localhost:4300'
const TENANT_PORT = Number(process.env.SMOKE_TENANT_PORT ?? 4500)
const TENANT_ORIGIN = `http://127.0.0.1:${TENANT_PORT}`
const PASSWORD = 'E2e-Password-1'
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 60_000)

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    'Refusing to run: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST ' +
      'must both be set. This harness creates accounts, orgs, sites and ' +
      'published pages — it must never be pointed at production.',
  )
  process.exit(1)
}

// ── env / clients ──────────────────────────────────────────────────────────

/** The web API key the console bundle was built with. */
function readEnvValue(key) {
  if (process.env[key]) return process.env[key]
  for (const file of ['apps/console/.env.development.local', 'apps/console/.env.local']) {
    try {
      const match = readFileSync(join(repoRoot, file), 'utf8').match(
        new RegExp(`^${key}=(.*)$`, 'm'),
      )
      if (match) return match[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      // Next file.
    }
  }
  return undefined
}

const API_KEY = readEnvValue('NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY')
const PROJECT_ID = readEnvValue('NEXT_PUBLIC_FIREBASE_PROJECT_ID') ?? 'aglyn-main'

initAdminApp({ projectId: PROJECT_ID })
const adminAuth = getAdminAuth()
const adminDb = getAdminFirestore()

// The CLIENT SDK, signed in as the customer — the same SDK and the same
// security rules the canvas save goes through. Used for the one write the
// product has no server route for (the canvas `nodes` save), so that write is
// still made under the customer's own credentials rather than bypassed with
// the Admin SDK.
const clientApp = initClientApp(
  { apiKey: API_KEY, projectId: PROJECT_ID },
  `agl1514-${Date.now()}`,
)
const clientAuth = getClientAuth(clientApp)
connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
  disableWarnings: true,
})
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
const clientDb = getClientFirestore(clientApp)
connectFirestoreEmulator(clientDb, fsHost, Number(fsPort))

// ── result ledger ──────────────────────────────────────────────────────────

const results = []
let failures = 0

function record(step, name, status, detail) {
  results.push({ step, name, status, detail })
  const mark = status === 'PASS' ? 'ok  ' : status === 'FAIL' ? 'FAIL' : '??  '
  if (status === 'FAIL') failures += 1
  console.log(`${mark} [${step}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function check(step, name, condition, detail) {
  record(step, name, condition ? 'PASS' : 'FAIL', detail)
  return Boolean(condition)
}

/** A third state. A step that could not be run is not a step that passed. */
function inconclusive(step, name, detail) {
  record(step, name, 'INCONCLUSIVE', detail)
}

// ── helpers ────────────────────────────────────────────────────────────────

const RUN = process.env.SMOKE_RUN_ID ?? `s${Date.now().toString(36)}`
const EMAIL = `agl1514-${RUN}@aglyn.test`
const ORG_NAME = `AGL1514 Smoke ${RUN}`
const SUBDOMAIN = `agl1514-${RUN}`.slice(0, 30)
const MARKER_PUBLISHED = `AGL1514-PUBLISHED-${RUN}`
const MARKER_SAVED_ONLY = `AGL1514-SAVED-ONLY-${RUN}`

/** A fresh ID token straight from the Auth emulator, so `email_verified`
 * reflects the CURRENT auth record rather than a token minted before the
 * verification applied. */
async function freshIdToken() {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    },
  )
  const payload = await response.json()
  if (!response.ok) throw new Error(`emulator sign-in failed: ${JSON.stringify(payload)}`)
  return payload.idToken
}

async function consoleApi(path, body, idToken) {
  const response = await fetch(`${CONSOLE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  return { status: response.status, payload }
}

/**
 * A tenant request on the `*.localhost:4500` subdomain — the local stand-in
 * for `<subdomain>.aglyn.app`. The Host header is what the middleware reads,
 * so no DNS entry is needed.
 *
 * `node:http`, NOT `fetch`: `Host` is a forbidden header name for undici, so
 * a fetch silently sends `Host: 127.0.0.1:4500`, the middleware falls through
 * to its custom-domain branch and answers 307 to app.aglyn.com. Every tenant
 * assertion then reads a redirect instead of the site — a failure that looks
 * like the site being down rather than like the harness being wrong.
 */
function tenantFetch(path, { host = `${SUBDOMAIN}.localhost:${TENANT_PORT}` } = {}) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: TENANT_PORT,
        path,
        method: 'GET',
        headers: { Host: host },
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          text += chunk
        })
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            ms: Date.now() - started,
            cache: response.headers['x-nextjs-cache'] ?? null,
            location: response.headers.location ?? null,
            text,
          }),
        )
      },
    )
    request.on('error', reject)
    request.end()
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ─────────────────────────────────────────────────────────────────────────
// Step 0 — preflight
// ─────────────────────────────────────────────────────────────────────────

console.log(`\nAGL-1514 launch smoke — run ${RUN}`)
console.log(`  console ${CONSOLE_URL}   tenant ${TENANT_ORIGIN}   email ${EMAIL}\n`)

check(
  '0-preflight',
  'console dev server answers /signup',
  (await fetch(`${CONSOLE_URL}/signup`).then((r) => r.status).catch(() => 0)) === 200,
)

// Which tenant server is on 4500 decides whether the cache assertions can
// mean anything: `next dev` has no incremental cache and emits no
// `x-nextjs-cache` at all.
const tenantProbe = await tenantFetch('/', { host: `localhost:${TENANT_PORT}` }).catch(() => null)
const TENANT_IS_PRODUCTION = Boolean(tenantProbe?.cache)
record(
  '0-preflight',
  'tenant server mode',
  tenantProbe ? 'PASS' : 'FAIL',
  tenantProbe
    ? TENANT_IS_PRODUCTION
      ? `production build (x-nextjs-cache: ${tenantProbe.cache}) — cache assertions are live`
      : 'next dev (no x-nextjs-cache header) — cache assertions will be INCONCLUSIVE'
    : 'no answer on 4500',
)

// A leftover from a previous run, or from seed-e2e.mjs, must never be able to
// stand in for the objects this run creates.
const preexisting = new Set(
  (await adminDb.collection('orgs').get()).docs.map((snapshot) => snapshot.id),
)
check(
  '0-preflight',
  'this run’s account does not already exist',
  !(await adminAuth.getUserByEmail(EMAIL).catch(() => null)),
  EMAIL,
)

// ─────────────────────────────────────────────────────────────────────────
// Step 1 — signup, from the real signup surface
// ─────────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const page = await browser.newPage()
const pageErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text().slice(0, 300))
})

await page.goto(`${CONSOLE_URL}/signup`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
await page.waitForSelector('input[name="firstName"]', { timeout: TIMEOUT_MS })

async function fillSignUpForm() {
  await page.fill('input[name="firstName"]', 'Smoke')
  await page.fill('input[name="lastName"]', 'Tester')
  await page.fill('input[name="organization"]', ORG_NAME)
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="Passwd"]', PASSWORD)
  await page.fill('input[name="ConfirmPasswd"]', PASSWORD)
}

// NEGATIVE — the clickwrap gate (AGL-1497). Submit the complete form with the
// consent box UNTICKED: it must refuse, and no account may exist afterwards.
await fillSignUpForm()
check(
  '1-signup',
  'consent box starts unticked',
  (await page.isChecked('input[type=checkbox]')) === false,
)
await page.click('button:has-text("Next")')
await page.waitForTimeout(4000)
const refusalText = await page.innerText('body')
check(
  '1-signup',
  'NEGATIVE: unticked clickwrap refuses the signup',
  /accept the Terms of Service/i.test(refusalText),
  refusalText.match(/Please accept[^\n]*/)?.[0],
)
check(
  '1-signup',
  'NEGATIVE: refused signup created NO account',
  !(await adminAuth.getUserByEmail(EMAIL).catch(() => null)),
)

// POSITIVE — tick the box and submit.
const signupStarted = Date.now()
await page.check('input[type=checkbox]')
await fillSignUpForm()
await page.click('button:has-text("Next")')

let user = null
for (let attempt = 0; attempt < 40 && !user; attempt += 1) {
  await sleep(1000)
  user = await adminAuth.getUserByEmail(EMAIL).catch(() => null)
}
const signupMs = Date.now() - signupStarted
if (
  check('1-signup', 'account created from the signup form', Boolean(user), user?.uid) &&
  check('1-signup', 'new account is UNVERIFIED', user.emailVerified === false)
) {
  record('1-signup', 'signup wall-clock', 'PASS', `${signupMs} ms to the auth record`)
}

const UID = user?.uid
const acceptances = UID
  ? (await adminDb.collection('users').doc(UID).collection('legalAcceptances').get()).docs
  : []
check(
  '1-signup',
  'clickwrap acceptance recorded (AGL-1497)',
  acceptances.length === 1 &&
    acceptances[0].data().method === 'clickwrap' &&
    acceptances[0].data().context === 'signup-password' &&
    Array.isArray(acceptances[0].data().documents) &&
    acceptances[0].data().documents.length >= 2 &&
    Boolean(acceptances[0].data().acceptedAt),
  acceptances[0] &&
    `${acceptances[0].id} ${acceptances[0].data().method}/${acceptances[0].data().context}`,
)

// ─────────────────────────────────────────────────────────────────────────
// Step 2 — the org the signup form provisioned
// ─────────────────────────────────────────────────────────────────────────

let orgId = null
for (let attempt = 0; attempt < 30 && !orgId; attempt += 1) {
  const owned = await adminDb.collection('orgs').where('ownerUid', '==', UID).get()
  if (owned.size) orgId = owned.docs[0].id
  else await sleep(1000)
}
check('2-org', 'signup provisioned an org (AGL-1523)', Boolean(orgId), orgId)
check('2-org', 'the org is NEW, not a seeded fixture', orgId && !preexisting.has(orgId), orgId)

const orgDoc = orgId ? (await adminDb.collection('orgs').doc(orgId).get()).data() : null
check('2-org', 'org name is the one typed at signup', orgDoc?.name === ORG_NAME, orgDoc?.name)
check('2-org', 'org owner is the new account', orgDoc?.ownerUid === UID)

// The FREE plan. A brand-new org carries NO `plan` field at all —
// `resolveEffectivePlan` (libs/aglyn/.../plan-entitlements.ts) answers 'free'
// for a missing or unknown plan — so a data assertion on the field would be
// asserting the absence of a value and calling it a tier. What is asserted
// instead, here and at step 5, is the free tier's BEHAVIOUR: the gates the
// free entitlements actually drive.
check(
  '2-org',
  'org carries no paid plan (free is the absence of one)',
  !orgDoc?.plan || orgDoc.plan === 'free',
  `plan=${JSON.stringify(orgDoc?.plan)} subscriptionStatus=${JSON.stringify(orgDoc?.subscriptionStatus)}`,
)
check(
  '2-org',
  'org carries no subscription',
  !orgDoc?.subscriptionId && !orgDoc?.stripeSubscriptionId,
)

const membership = orgId
  ? (await adminDb.collection('orgs').doc(orgId).collection('members').doc(UID).get()).data()
  : null
check('2-org', 'owner membership row exists', membership?.role === 'owner', membership?.role)

// NEGATIVE — the AGL-1523 grace is ONE workspace for a brand-new unverified
// account, not a hole. A second create with the same still-unverified token
// must be refused.
const unverifiedToken = await freshIdToken()
const secondOrg = await consoleApi(
  '/api/orgs/create',
  { name: `${ORG_NAME} SECOND` },
  unverifiedToken,
)
check(
  '2-org',
  'NEGATIVE: a second org on the unverified account is refused',
  secondOrg.status === 403,
  `HTTP ${secondOrg.status} ${JSON.stringify(secondOrg.payload)}`,
)

// ─────────────────────────────────────────────────────────────────────────
// Step 3 — email verification, as the emulator models it
// ─────────────────────────────────────────────────────────────────────────

// NEGATIVE (and the reason verification is on the critical path): site
// creation refuses an unverified account outright — no grace here.
const hostBeforeVerify = await consoleApi(
  '/api/hosts/create',
  { displayName: ORG_NAME, subdomain: SUBDOMAIN, orgId },
  unverifiedToken,
)
check(
  '3-verify',
  'NEGATIVE: site creation refuses the unverified account',
  hostBeforeVerify.status === 403,
  `HTTP ${hostBeforeVerify.status} ${JSON.stringify(hostBeforeVerify.payload)}`,
)

// The link the product mails. Generated with the Admin SDK — the same call
// `/api/auth/send-verification` makes — and then APPLIED through the real
// `/verify-email` page, which is the half AGL-1524 was about. Transmission
// is deliberately not exercised: this box has a live Resend key and a
// smoke test must not send mail to a made-up address.
const verifyLink = await adminAuth.generateEmailVerificationLink(EMAIL)
const oobCode = new URL(verifyLink).searchParams.get('oobCode')
check('3-verify', 'verification link carries an oobCode', Boolean(oobCode))

// `commit`, and tolerant of an abort: the app redirects out of this route as
// soon as the code applies, which supersedes the navigation and would
// otherwise throw ERR_ABORTED on a successful verification.
await page
  .goto(`${CONSOLE_URL}/verify-email?oobCode=${oobCode}`, {
    waitUntil: 'commit',
    timeout: TIMEOUT_MS,
  })
  .catch(() => undefined)
let verified = false
for (let attempt = 0; attempt < 30 && !verified; attempt += 1) {
  await sleep(1000)
  verified = (await adminAuth.getUser(UID)).emailVerified
}
check('3-verify', 'the /verify-email page applied the code (AGL-1524)', verified)

// NEGATIVE — a spent code must not verify anything a second time.
const replay = await fetch(
  `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oobCode }),
  },
)
check(
  '3-verify',
  'NEGATIVE: replaying the spent oobCode is refused',
  replay.status >= 400,
  `HTTP ${replay.status}`,
)

// ─────────────────────────────────────────────────────────────────────────
// Step 4 — the Host
// ─────────────────────────────────────────────────────────────────────────

const verifiedToken = await freshIdToken()
const hostStarted = Date.now()
const created = await consoleApi(
  '/api/hosts/create',
  { displayName: `${ORG_NAME} Site`, subdomain: SUBDOMAIN, orgId },
  verifiedToken,
)
check(
  '4-host',
  'site created once the address is verified',
  created.status === 200,
  `HTTP ${created.status} ${JSON.stringify(created.payload)} in ${Date.now() - hostStarted} ms`,
)
const hostId = created.payload?.hostId ?? created.payload?.id
check('4-host', 'the API returned a host id', Boolean(hostId), hostId)

const hostDoc = hostId ? (await adminDb.collection('hosts').doc(hostId).get()).data() : null
check('4-host', 'host doc carries this run’s subdomain', hostDoc?.subdomain === SUBDOMAIN, hostDoc?.subdomain)
check('4-host', 'host doc belongs to the new org', hostDoc?.orgId === orgId)
check(
  '4-host',
  'a fresh site publishes NOTHING (routing map is empty)',
  hostDoc && Object.keys(hostDoc.screens ?? {}).length === 0,
  JSON.stringify(hostDoc?.screens ?? {}),
)
const hostIndex = hostId ? (await adminDb.collection('hostIndex').doc(hostId).get()).data() : null
check('4-host', 'hostIndex mirror written', hostIndex?.orgId === orgId)

// FREE-TIER ENTITLEMENT, asserted as behaviour: `hostLimit: 1`. The second
// site on a free org must be refused. This is what makes "the org landed on
// the free plan" a claim about the product rather than about a missing field.
const secondSite = await consoleApi(
  '/api/hosts/create',
  { displayName: `${ORG_NAME} Second Site`, subdomain: `${SUBDOMAIN}-2`.slice(0, 30), orgId },
  verifiedToken,
)
check(
  '4-host',
  'NEGATIVE: free plan refuses a SECOND site (hostLimit 1)',
  secondSite.status >= 400,
  `HTTP ${secondSite.status} ${JSON.stringify(secondSite.payload)}`,
)

// NEGATIVE — the tenant really reads the subdomain. An address nobody
// registered must 404 rather than falling back to the demo site.
const strangerHost = await tenantFetch('/', { host: `agl1514-nobody-${RUN}.localhost:${TENANT_PORT}` })
check(
  '4-host',
  'NEGATIVE: an unregistered subdomain 404s (no demo fallback)',
  strangerHost.status === 404,
  `HTTP ${strangerHost.status}`,
)

// ─────────────────────────────────────────────────────────────────────────
// Step 5 — publish, and the page actually served
// ─────────────────────────────────────────────────────────────────────────

// NEGATIVE, and the one that makes the 200 below mean something: the site
// exists and answers, but its root has nothing published yet.
const beforeAnything = await tenantFetch('/')
check(
  '5-publish',
  'NEGATIVE: the registered site 404s before anything is published',
  beforeAnything.status === 404,
  `HTTP ${beforeAnything.status}`,
)

const screenId = `agl1514-${RUN}-home`
const versionId = `${screenId}-v1`
const screenCreate = await consoleApi(
  '/api/hosts/resources',
  {
    hostId,
    resource: 'screen',
    id: screenId,
    data: { displayName: 'Home', kind: 'page', versionId },
  },
  verifiedToken,
)
check('5-publish', 'screen doc created', screenCreate.status === 200, `HTTP ${screenCreate.status}`)

const versionCreate = await consoleApi(
  '/api/hosts/versions',
  {
    hostId,
    kind: 'screen',
    parentId: screenId,
    id: versionId,
    data: {
      screenId,
      nodes: {
        '_@_': { $id: '_@_', componentId: 'root', nodes: ['wrap'] },
        wrap: { $id: 'wrap', componentId: 'muiContainer', parentId: '_@_', nodes: ['headline'] },
        headline: {
          $id: 'headline',
          componentId: 'muiTypography',
          parentId: 'wrap',
          props: { children: MARKER_PUBLISHED, variant: 'h1' },
        },
      },
    },
  },
  verifiedToken,
)
check('5-publish', 'first version created', versionCreate.status === 200, `HTTP ${versionCreate.status}`)

// FREE-TIER ENTITLEMENT, again as behaviour: `versioning: false`. The first
// version of a resource is free on every plan; a SECOND one is what the
// entitlement sells, so it must be refused here.
const secondVersion = await consoleApi(
  '/api/hosts/versions',
  {
    hostId,
    kind: 'screen',
    parentId: screenId,
    id: `${versionId}-second`,
    data: { screenId, nodes: { '_@_': { $id: '_@_', componentId: 'root', nodes: [] } } },
  },
  verifiedToken,
)
check(
  '5-publish',
  'NEGATIVE: free plan refuses a SECOND version (versioning entitlement)',
  secondVersion.status >= 400,
  `HTTP ${secondVersion.status} ${JSON.stringify(secondVersion.payload)}`,
)

// NEGATIVE — a screen with content and a versionId is still NOT published.
// Publishing is the routing-map entry, and this is what proves the 200 later
// is the publish and not the screen's mere existence.
const beforePublish = await tenantFetch('/')
check(
  '5-publish',
  'NEGATIVE: an unrouted screen is still not served',
  beforePublish.status === 404,
  `HTTP ${beforePublish.status}`,
)

// PUBLISH — through the console UI, the way a customer does it: the screens
// page's Path field. `publishScreenRoute` writes the screen's slug and the
// host's routing-map entry with the CLIENT SDK; there is no server route for
// it, so a browser is the only honest way to make this write.
const publishStarted = Date.now()
const orgSlug = orgDoc?.slug
// The console's `[host]` segment is the SUBDOMAIN, not the host doc id — the
// host shell resolves it (`HostGuard`). A doc id in that position renders the
// app's own "This page isn't here".
const published = await publishRootThroughConsole(
  page,
  `${CONSOLE_URL}/${orgSlug}/hosts/${SUBDOMAIN}/screens/${screenId}/versions/${versionId}/view`,
)
record(
  '5-publish',
  'publish performed through the console UI',
  published.ok ? 'PASS' : 'FAIL',
  published.detail,
)

const publishedHost = hostId ? (await adminDb.collection('hosts').doc(hostId).get()).data() : null
check(
  '5-publish',
  'routing map now points “/” at this run’s screen',
  publishedHost?.screens?.[screenId] === '/',
  JSON.stringify(publishedHost?.screens ?? {}),
)
const publishMs = Date.now() - publishStarted

// THE ASSERTION THAT MATTERS: content this run typed, on the public address.
const served = await tenantFetch('/')
check('5-publish', 'the published page is served', served.status === 200, `HTTP ${served.status}`)
check(
  '5-publish',
  'the served page carries THIS RUN’s unique string',
  served.text.includes(MARKER_PUBLISHED),
  `${MARKER_PUBLISHED} — ${served.ms} ms, ${served.text.length} bytes`,
)
record('5-publish', 'publish wall-clock', 'PASS', `${publishMs} ms from click to routing map`)

// Second fetch — one fetch says nothing about caching.
const servedAgain = await tenantFetch('/')
if (TENANT_IS_PRODUCTION) {
  check(
    '5-publish',
    'second fetch is a cache HIT',
    servedAgain.cache === 'HIT',
    `first=${served.cache} second=${servedAgain.cache}`,
  )
} else {
  inconclusive(
    '5-publish',
    'MISS→HIT on the second fetch',
    'the tenant on this port is `next dev`, which has no incremental cache and ' +
      'emits no x-nextjs-cache — run the tenant as a production build to assert this',
  )
}

// THE TRAP: a live-screen SAVE never revalidates. Write new content onto the
// version that is already live — as the customer, through the client SDK and
// the same security rules the canvas obeys — and the public page must NOT
// change until a publish (a versionId move) or an explicit revalidation.
await signInWithEmailAndPassword(clientAuth, EMAIL, PASSWORD)
await setDoc(
  doc(clientDb, 'hosts', hostId, 'screens', screenId, 'versions', versionId),
  {
    nodes: {
      '_@_': { $id: '_@_', componentId: 'root', nodes: ['wrap'] },
      wrap: { $id: 'wrap', componentId: 'muiContainer', parentId: '_@_', nodes: ['headline'] },
      headline: {
        $id: 'headline',
        componentId: 'muiTypography',
        parentId: 'wrap',
        props: { children: MARKER_SAVED_ONLY, variant: 'h1' },
      },
    },
  },
  { merge: true },
)
const savedDoc = await adminDb
  .doc(`hosts/${hostId}/screens/${screenId}/versions/${versionId}`)
  .get()
check(
  '5-publish',
  'the save reached Firestore under the customer’s own credentials',
  JSON.stringify(savedDoc.data()?.nodes ?? {}).includes(MARKER_SAVED_ONLY),
)

const afterSave = await tenantFetch('/')
if (TENANT_IS_PRODUCTION) {
  check(
    '5-publish',
    'a live-screen SAVE does not change the public page',
    afterSave.text.includes(MARKER_PUBLISHED) && !afterSave.text.includes(MARKER_SAVED_ONLY),
    `x-nextjs-cache=${afterSave.cache}`,
  )
} else {
  inconclusive(
    '5-publish',
    'a live-screen SAVE does not change the public page',
    `next dev renders every request, so the save is visible immediately ` +
      `(marker present: ${afterSave.text.includes(MARKER_SAVED_ONLY)}). This ` +
      'assertion only means something against a production build.',
  )
}

// ── report ────────────────────────────────────────────────────────────────

await browser.close()

console.log('\n─── AGL-1514 launch smoke ───')
const counts = results.reduce((totals, row) => {
  totals[row.status] = (totals[row.status] ?? 0) + 1
  return totals
}, {})
console.log(
  `PASS ${counts.PASS ?? 0}   FAIL ${counts.FAIL ?? 0}   INCONCLUSIVE ${counts.INCONCLUSIVE ?? 0}`,
)
console.log(
  JSON.stringify(
    { run: RUN, email: EMAIL, uid: UID, orgId, hostId, screenId, versionId, subdomain: SUBDOMAIN },
    null,
    2,
  ),
)
if (pageErrors.length) console.log('browser console errors:', pageErrors.slice(0, 10))
process.exit(failures ? 1 : 0)

// ── the console-UI publish click ──────────────────────────────────────────

/**
 * Publishes the screen at the site root the way a customer does: the version
 * view page's Publishing card — type `/` into the Slug field, click Publish.
 * That button is `handlePublishRoute`, which writes the screen's slug and the
 * host's routing-map entry with the client SDK and then drops the tenant's
 * caches. There is no server route for that write, so a browser is the only
 * honest way to make it.
 *
 * Reports what it actually did, so a moved control fails loudly instead of
 * letting the run pass on a publish that never happened.
 */
async function publishRootThroughConsole(pageHandle, viewUrl) {
  try {
    await pageHandle.goto(viewUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    const slugField = pageHandle.getByLabel('Slug', { exact: true })
    await slugField.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    // The publishing chip. `text=Published` would also match "Unpublished",
    // which is how a "did it publish?" assertion passes on a page that says
    // the opposite — read the chip's exact text instead.
    const chip = () =>
      pageHandle.evaluate(() =>
        [...document.querySelectorAll('.MuiChip-label')]
          .map((node) => node.textContent.trim())
          .find((label) => label === 'Published' || label === 'Unpublished'),
      )
    const before = await chip()
    await slugField.fill('/')
    // Located by textContent, NOT by accessible name: MUI uppercases button
    // labels with `text-transform`, and Playwright's accessible name is the
    // RENDERED text, so `getByRole('button', { name: 'Publish', exact: true })`
    // matches for the split second before emotion injects the styles and stops
    // matching afterwards. It fails as "control not found" — or, worse, as a
    // stale handle on a different button.
    const clicked = await pageHandle.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent.trim() === 'Publish',
      )
      if (!button) return 'not-found'
      if (button.disabled) return 'disabled'
      button.click()
      return 'clicked'
    })
    if (clicked !== 'clicked') {
      return { ok: false, detail: `the Publish button was ${clicked}` }
    }
    await pageHandle.waitForTimeout(5000)
    const after = await chip()
    return {
      ok: after === 'Published',
      detail: `clicked Publish with slug "/" — chip went ${before} → ${after}`,
    }
  } catch (error) {
    return { ok: false, detail: `UI publish failed: ${String(error).slice(0, 200)}` }
  }
}

function chromeExecutable() {
  if (process.env.E2E_CHROME_PATH) return { executablePath: process.env.E2E_CHROME_PATH }
  if (process.platform === 'darwin') {
    for (const executablePath of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      try {
        readFileSync(executablePath)
        return { executablePath }
      } catch {
        // Next flavor.
      }
    }
  }
  return { channel: 'chrome' }
}
