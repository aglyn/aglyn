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

/**
 * CAN A STRANGER SIGN UP RIGHT NOW? (AGL-2715)
 *
 * The only thing on this platform that answers that by DOING it. Every other
 * signup check is an inference: the auth doors assert Identity Platform is
 * reachable and refuses an account that cannot exist, `probeCreate` reads that
 * the platform is unlocked and a name is free, and the volume/refusal/drought
 * checks count what happened afterwards. On the day AGL-2714 paged, the
 * strongest thing any of them could say was "somebody got an account
 * recently", and recently was 24 hours ago.
 *
 * AGL-2581 is what that costs: signup refused every visitor for three days
 * while the monitor named for signups stayed green.
 *
 * ## The walk, in two halves
 *
 * **The mechanism**, over the real HTTP surfaces: create an account through
 * Identity Platform's own REST API — the same endpoint the browser SDK calls —
 * verify the email by minting the link and redeeming its `oobCode`, mint a
 * session at `/api/auth/session`, provision an org at `/api/orgs/create`, and
 * read the org back out of Firestore. Then delete every artifact and verify
 * each one is gone.
 *
 * **The front door**, in a real browser with NO bypass header: load `/signup`
 * as an anonymous visitor and assert the form is actually there. This half
 * exists because the mechanism half is structurally blind to the thing that
 * has actually bitten this platform — bot protection answering real people
 * with a challenge. The mechanism walk carries `x-aglyn-probe` and sails past
 * the edge; a visitor does not. Measured 2026-09-09: an ordinary desktop
 * Chrome User-Agent gets `429 x-vercel-mitigated: challenge` on a plain fetch,
 * and a browser solves it. So a fetch-only canary would report green through
 * an edge that was refusing everybody.
 *
 * ## Why the mechanism half is allowed to use the bypass
 *
 * `x-aglyn-probe` is the existing "CI and uptime probe bypass" that
 * `uptime-probe.yml` already depends on, and `firewall-posture.mjs` asserts
 * its scope so it cannot be silently widened. Using it here punches no new
 * hole. The front-door half is what keeps the bypass from hiding anything.
 *
 * ## Residue is a failure, even when the signup worked
 *
 * A canary that walks perfectly and does not clean up leaves a real org, a
 * real slug reservation and a real member roster on the production estate
 * every hour, forever. `reapedCleanly: false` is graded red by
 * `signupCanaryHealth` for exactly that reason. Every run also sweeps
 * residue left by a PREVIOUS run that died mid-walk, before it starts its
 * own — a crashed run must not accumulate.
 *
 * ## What this deliberately does NOT prove
 *
 * Email DELIVERY. The verification link is minted with the admin SDK rather
 * than read out of an inbox, so this asserts the redemption path and not that
 * the message arrived. Delivery is graded separately by the
 * `verificationDelivery` door on `/api/health/auth-doors`, against real
 * accounts, and duplicating it here would mean running a mailbox.
 *
 * ## The org it creates is real, and that is the point
 *
 * It bills nothing (a free workspace), and it is deleted within seconds. It
 * does briefly exist, and it does send the owner a welcome email — that is
 * the real signup path, and refusing to walk it is how you end up with a
 * check that proves nothing.
 *
 *   node tools/e2e/signup-canary.mjs
 *
 * Refuses to run without `SIGNUP_CANARY_ENABLE=1`, so it cannot be started by
 * accident from a shell that happens to have production credentials.
 */

import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'

const require = createRequire(import.meta.url)
// The repo's own reader, not a second copy: it owns the variable names and
// the newline unescaping the private key needs.
const { readServiceAccount } =
  await import('../scripts/lib/firebase-rules-api.mjs')
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')

const CONSOLE = process.env['SIGNUP_CANARY_ORIGIN'] ?? 'https://app.aglyn.com'
const PROBE = process.env['AGLYN_PROBE_TOKEN'] ?? ''
const API_KEY = process.env['NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY'] ?? ''
/**
 * Where the canary's welcome mail goes.
 *
 * A REAL, deliverable address on purpose. Org creation welcomes the owner of
 * a first workspace, so an address that hard-bounces would hand the sending
 * domain a bounce every hour — a reputation cost paid to avoid an inbox rule.
 * Plus-addressed and unique per run, because each walk creates a new account.
 */
const EMAIL_BASE =
  process.env['SIGNUP_CANARY_EMAIL'] ?? 'zach+signup-canary@aglyn.com'
const IDP = 'https://identitytoolkit.googleapis.com/v1'

/**
 * Every slug this canary creates starts here, and the orphan sweep is bounded
 * to it — so the sweep can never reach a customer's workspace.
 */
const CANARY_SLUG_PREFIX = 'signup-canary-'

const steps = []
const t0 = Date.now()
let step = 'start'

function begin(name) {
  step = name
  steps.push({ name, startedAt: Date.now() })
  process.stdout.write(`  ${name} … `)
}
function done(detail = '') {
  const s = steps[steps.length - 1]
  s.ms = Date.now() - s.startedAt
  console.log(`ok ${s.ms}ms ${detail}`)
}

/** `fetch`, with the bypass header and a hard budget. Never used by the browser half. */
async function api(path, init = {}) {
  const res = await fetch(`${CONSOLE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      // The existing CI/uptime bypass. See the docblock.
      ...(PROBE ? { 'x-aglyn-probe': PROBE } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  })
  return res
}

async function idp(method, body) {
  const res = await fetch(`${IDP}/${method}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Identity Platform's error bodies name the account. Carry the CODE only.
    throw new Error(`${method} ${res.status} ${json?.error?.message ?? ''}`)
  }
  return json
}

/**
 * Delete everything one walk creates, and prove each piece is gone.
 *
 * The write set is `createOrganization`'s, read off the source rather than
 * guessed: `orgSlugs/{slug}`, `orgs/{orgId}` with its `members` and `billing`
 * subcollections, `users/{uid}/orgs/{orgId}`, and the account itself.
 * `recursiveDelete` is what handles the subcollections — deleting an org
 * document alone orphans them, and an orphaned subcollection is residue that
 * no listing would ever show.
 */
async function reap(db, auth, { uid, orgId, slug }) {
  const missed = []
  try {
    if (orgId) await db.recursiveDelete(db.collection('orgs').doc(orgId))
    if (slug) await db.collection('orgSlugs').doc(slug).delete()
    if (uid) await db.recursiveDelete(db.collection('users').doc(uid))
    if (uid) await auth.deleteUser(uid).catch(() => undefined)
  } catch (error) {
    missed.push(`delete threw: ${String(error).slice(0, 80)}`)
  }
  // Verified, not assumed. A delete that silently no-ops leaves residue that
  // reads as a clean run.
  if (orgId && (await db.collection('orgs').doc(orgId).get()).exists) {
    missed.push(`orgs/${orgId}`)
  }
  if (slug && (await db.collection('orgSlugs').doc(slug).get()).exists) {
    missed.push(`orgSlugs/${slug}`)
  }
  if (uid) {
    const stillThere = await auth.getUser(uid).then(
      () => true,
      () => false,
    )
    if (stillThere) missed.push(`auth/${uid}`)
  }
  return missed
}

/**
 * Clear anything a PREVIOUS run left behind before this one starts.
 *
 * A walk that dies between creating an org and reaping it leaves residue that
 * nothing else on the platform will ever collect, and the next run would add
 * to it rather than notice it. Bounded to canary-shaped names so it can never
 * touch a customer's workspace.
 */
async function sweepOrphans(db, auth) {
  const swept = []
  // A PREFIX range: the upper bound must be the prefix's successor. `>= p`
  // AND `< p` is the empty set — a sweeper written that way matches nothing
  // and looks exactly like a sweeper with nothing to do, while residue
  // accumulates forever behind a green run.
  const stale = await db
    .collection('orgs')
    .where('slug', '>=', CANARY_SLUG_PREFIX)
    .where('slug', '<', `${CANARY_SLUG_PREFIX}\uf8ff`)
    .limit(25)
    .get()
  for (const doc of stale.docs) {
    const slug = doc.get('slug')
    const ownerUid = doc.get('ownerUid')
    await reap(db, auth, { uid: ownerUid, orgId: doc.id, slug })
    swept.push(doc.id)
  }
  return swept
}

/**
 * The front door, as a stranger sees it: a real browser, no bypass header.
 *
 * Asserts the signup form is actually reachable and rendered. This is the half
 * the mechanism walk cannot do for itself — it carries the probe header and so
 * cannot observe the edge refusing everybody.
 */
async function walkFrontDoor() {
  const { chromium } = require('playwright-core')
  const executablePath =
    process.env['CHROME_PATH'] ??
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    const response = await page.goto(`${CONSOLE}/signup`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    const status = response?.status() ?? 0
    if (status !== 200) throw new Error(`/signup answered ${status}`)
    // The fields a person types into. Rendering the shell is not enough — the
    // outage this guards against served a challenge page with a 200.
    await page.waitForSelector('input[type="password"]', { timeout: 20_000 })
    const fields = await page.$$eval('input', (nodes) => nodes.length)
    if (fields < 4) throw new Error(`only ${fields} inputs on /signup`)
    return { status, fields }
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function main() {
  if (process.env['SIGNUP_CANARY_ENABLE'] !== '1') {
    console.error(
      'refusing to run: set SIGNUP_CANARY_ENABLE=1 to walk production signup',
    )
    process.exit(2)
  }
  if (!API_KEY)
    throw new Error('NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY is not set')
  if (!PROBE) throw new Error('AGLYN_PROBE_TOKEN is not set')

  const sa = readServiceAccount()
  if (!sa) throw new Error('admin credentials are not in the environment')
  const app = initializeApp(
    {
      credential: cert({
        projectId: sa.projectId,
        clientEmail: sa.clientEmail,
        privateKey: sa.privateKey,
      }),
    },
    `canary-${Date.now()}`,
  )
  const db = getFirestore(app)
  const auth = getAuth(app)

  const stamp = `${Date.now()}${randomBytes(2).toString('hex')}`
  const [local, domain] = EMAIL_BASE.split('@')
  const email = `${local}-${stamp}@${domain}`
  const password = `Cy-${randomBytes(18).toString('base64url')}`
  const slug = `${CANARY_SLUG_PREFIX}${stamp}`
  const created = { uid: null, orgId: null, slug: null }

  let failedStep = null
  let reapedCleanly = false
  let frontDoor = null

  try {
    begin('sweep-orphans')
    const swept = await sweepOrphans(db, auth)
    done(swept.length ? `cleared ${swept.length} from a previous run` : '')

    begin('account')
    const signUp = await idp('accounts:signUp', {
      email,
      password,
      returnSecureToken: true,
    })
    created.uid = signUp.localId
    done(`uid ${String(signUp.localId).slice(0, 6)}…`)

    begin('verify')
    // Minted rather than read from an inbox — see the docblock. This still
    // exercises the REDEMPTION path, which is the half that breaks.
    const link = await auth.generateEmailVerificationLink(email)
    const oobCode = new URL(link).searchParams.get('oobCode')
    if (!oobCode) throw new Error('no oobCode on the verification link')
    await idp('accounts:update', { oobCode })
    // The token minted at signup still says unverified. The session door
    // refuses those, so the walk needs a fresh one — which is also the proof
    // that verification actually took.
    const signIn = await idp('accounts:signInWithPassword', {
      email,
      password,
      returnSecureToken: true,
    })
    const decoded = await auth.verifyIdToken(signIn.idToken, true)
    if (!decoded.email_verified)
      throw new Error('still unverified after redeem')
    done()

    begin('session')
    const session = await api('/api/auth/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${signIn.idToken}` },
    })
    if (!session.ok) throw new Error(`session answered ${session.status}`)
    done()

    begin('org-create')
    const orgRes = await api('/api/orgs/create', {
      method: 'POST',
      headers: { authorization: `Bearer ${signIn.idToken}` },
      body: JSON.stringify({ name: `Signup canary ${stamp}`, slug }),
    })
    const orgBody = await orgRes.json().catch(() => ({}))
    if (!orgRes.ok) {
      throw new Error(`org-create ${orgRes.status} ${orgBody?.error ?? ''}`)
    }
    created.orgId = orgBody.orgId ?? orgBody.id ?? null
    created.slug = slug
    if (!created.orgId) throw new Error('org-create returned no id')
    done(`org ${created.orgId}`)

    begin('assert')
    const org = await db.collection('orgs').doc(created.orgId).get()
    if (!org.exists) throw new Error('the org the API returned does not exist')
    if (org.get('ownerUid') !== created.uid) {
      throw new Error('the org is owned by somebody else')
    }
    done()

    begin('front-door')
    frontDoor = await walkFrontDoor()
    done(`${frontDoor.fields} inputs`)
  } catch (error) {
    failedStep = step
    console.log(`FAILED at ${step}: ${String(error).slice(0, 200)}`)
  }

  // Always, on every path. A failed walk that leaves residue is two problems.
  begin('reap')
  const missed = await reap(db, auth, created)
  reapedCleanly = missed.length === 0
  done(reapedCleanly ? 'clean' : `MISSED ${missed.join(', ')}`)

  const elapsedMs = Date.now() - t0
  const ok = failedStep === null

  // The marker the health door reads. Written with the admin SDK rather than
  // through the workspace lib because this runs outside the app; the field
  // names are asserted against the reader by
  // `apps/console/specs/signup-canary-marker-wiring.spec.ts`, so the two
  // cannot drift.
  await db
    .collection('rateLimits')
    .doc('signupCanary_production')
    .set({
      walkedAtMs: Date.now(),
      ok,
      failedStep,
      elapsedMs,
      reapedCleanly,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

  console.log(
    `\n${ok && reapedCleanly ? 'PASS' : 'FAIL'} — walk ${elapsedMs}ms` +
      `${failedStep ? `, failed at ${failedStep}` : ''}` +
      `${reapedCleanly ? '' : ', LEFT RESIDUE'}`,
  )
  process.exit(ok && reapedCleanly ? 0 : 1)
}

main().catch((error) => {
  console.error(`canary aborted: ${String(error).slice(0, 300)}`)
  process.exit(1)
})
