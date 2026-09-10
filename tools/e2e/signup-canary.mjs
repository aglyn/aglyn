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
 * ## The walk
 *
 * In a real browser, because it has to be. Identity Platform enforces App
 * Check and this project's provider is reCAPTCHA Enterprise, which has no
 * server-side equivalent: `accounts:signUp` from any script is refused
 * `401 Firebase App Check token is invalid`. That is the control working, not
 * a wall to climb.
 *
 * Fill the real signup form, submit, land on `/verify-email`, mint the
 * verification link, open the URL a person would click, arrive on the
 * workspace dashboard with an org provisioned, read it back out of Firestore —
 * then delete every artifact and prove each one is gone.
 *
 * A browser also means the edge is exercised for real. The walk carries no
 * bypass header of any kind, so if bot protection starts refusing visitors the
 * canary is refused with them. That is the point, and the reason this is not a
 * fetch script carrying the CI bypass that `uptime-probe.yml` uses.
 *
 * ## ⚠️ The one carve-out, and how it is covered
 *
 * An App Check **debug token** is injected before page scripts run, because
 * reCAPTCHA Enterprise is designed to score headless automation as a bot and
 * always will. Everything else in the journey is real; the attestation step is
 * not. So this canary CANNOT detect App Check being misconfigured for real
 * visitors.
 *
 * That is covered, not merely disclosed. `appCheckAttestationHealth` grades
 * `services/verification_count` — every request from every visitor — and one
 * canary request an hour against roughly a thousand a day cannot hold it
 * green. `app-check-debug-token.spec.ts` fails if that cover is ever deleted.
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

/**
 * The console to walk. No default, deliberately: a hard-coded Aglyn hostname
 * would put this on the self-host ratchet, and a self-hoster's canary should
 * walk THEIR console. Set `SIGNUP_CANARY_ORIGIN`.
 */
const CONSOLE = process.env['SIGNUP_CANARY_ORIGIN'] ?? ''
/**
 * Where the canary's welcome mail goes. Required — no default.
 *
 * It must be a REAL, deliverable address. Org creation welcomes the owner of a
 * first workspace, so an address that hard-bounces would hand the sending
 * domain a bounce every hour: a reputation cost paid to avoid an inbox rule.
 * The run plus-addresses it per walk, because each walk creates a new account.
 *
 * No default, for the same reason `SIGNUP_CANARY_ORIGIN` has none — a literal
 * here is an Aglyn address in a file a self-hoster runs, and it puts this on
 * the self-host ratchet.
 */
const EMAIL_BASE = process.env['SIGNUP_CANARY_EMAIL'] ?? ''

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
 * The walk, in a real browser, as a stranger performs it.
 *
 * Everything below happens on a page — not in `fetch` — because it has to.
 * Identity Platform enforces App Check and this project's provider is
 * reCAPTCHA Enterprise, which has no server-side equivalent: `accounts:signUp`
 * from any script is refused `401 Firebase App Check token is invalid`. That
 * is not a wall to climb, it is the control working.
 *
 * A browser also means bot protection is exercised for real. The walk carries
 * no bypass header of any kind, so if the edge starts refusing visitors the
 * canary is refused with them — which is the whole point, and the reason this
 * is not a fetch script riding the CI bypass.
 *
 * ⚠️ THE ONE CARVE-OUT, AND WHAT IT COSTS. An App Check **debug token** is
 * injected before page scripts run, because reCAPTCHA Enterprise is designed
 * to score headless automation as a bot and will always do so. Everything else
 * in the journey is real; the attestation step is not. So this canary CANNOT
 * detect App Check being misconfigured for real visitors. That gap is named
 * here rather than left to be discovered, and it is the reason the token is a
 * secret with a single purpose and a name that says so.
 */
async function walk(page, db, auth, identity, created) {
  const { email, password, org, slug } = identity

  begin('signup-form')
  await page.goto(`${CONSOLE}/signup`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  // The password field, not just the shell: a Vercel challenge page is served
  // with a 200 and no form on it, so waiting for the document proves nothing.
  await page.waitForSelector('input[name="Passwd"]', { timeout: 20_000 })
  done()

  begin('account')
  await page.fill('input[name="firstName"]', 'Signup')
  await page.fill('input[name="lastName"]', 'Canary')
  await page.fill('input[name="organization"]', org)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="Passwd"]', password)
  await page.fill('input[name="ConfirmPasswd"]', password)
  // The clickwrap is load-bearing: the launch smoke asserts an unticked box
  // refuses the signup.
  await page.check('input[type="checkbox"]')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/verify-email/, { timeout: 45_000 })
  const user = await auth.getUserByEmail(email)
  created.uid = user.uid
  if (user.emailVerified) throw new Error('a new account arrived pre-verified')
  done(`uid ${user.uid.slice(0, 6)}…`)

  begin('hold-name')
  /**
   * Wait for the typed workspace name to be DURABLE before touching anything.
   *
   * An unverified signup does not create the org — `rememberPendingSignUpWorkspace`
   * writes the typed name to `users/{uid}.pendingSignUpWorkspace` from the
   * browser, and the workspace is provisioned from it on the first verified
   * session. That is a client-side Firestore write, and redeeming the code
   * before it lands loses the name: the account verifies, no org is ever
   * created, and the walk fails at a step that looks unrelated.
   *
   * This was found the expensive way. An early run passed only because an
   * unrelated retry loop happened to stall for 75 seconds first, and every run
   * without that accident failed. Waiting on the document rather than on a
   * timer is what makes it deterministic.
   */
  const heldBy = Date.now() + 45_000
  let held = false
  while (Date.now() < heldBy && !held) {
    const snap = await db.collection('users').doc(created.uid).get()
    held = Boolean(snap.exists && snap.get('pendingSignUpWorkspace')?.name)
    if (!held) await new Promise((r) => setTimeout(r, 1_500))
  }
  if (!held) {
    throw new Error('the typed workspace name was never held for provisioning')
  }
  done()

  begin('verify-mint')
  /**
   * No `url` in the settings. The console origin is not an authorized continue
   * domain and passing it fails the generate call itself with
   * `auth/internal-error`; the product discards Firebase's handler URL anyway
   * and keeps only the code.
   *
   * Retried, because the signup page fires its own verification send and a
   * mint immediately behind it is throttled — measured at five refusals
   * before the sixth attempt succeeded.
   */
  let link = null
  let lastCode = ''
  for (let attempt = 1; attempt <= 8 && !link; attempt++) {
    try {
      link = await auth.generateEmailVerificationLink(email)
    } catch (error) {
      lastCode = String(error?.code ?? error)
      if (attempt === 8) {
        // `cause` kept: the code is what the body reports, but the original
        // error is the only thing that says WHY Identity Platform refused.
        throw new Error(`link never minted (${lastCode})`, { cause: error })
      }
      await new Promise((r) => setTimeout(r, 6_000 + attempt * 4_000))
    }
  }
  const oobCode = new URL(link).searchParams.get('oobCode')
  if (!oobCode) throw new Error('minted link carried no oobCode')
  done(lastCode ? `after retries (${lastCode})` : '')

  begin('verify-click')
  /**
   * The SAME tab, which is what actually happens.
   *
   * A mail client opens the link in the browser the person is already using,
   * and `/verify-email?mode=verifyEmail&oobCode=…` is an Aglyn page that
   * redeems the code and carries the session straight on to the workspace it
   * provisions. Redeeming in a sibling tab instead leaves the original signed
   * out at `/signin` and no org is ever created — measured, both ways.
   *
   * Built the way `authActionUrl` builds it: Firebase's own handler is
   * bypassed by the product, which keeps only the code.
   */
  await page.goto(
    `${CONSOLE}/verify-email?mode=verifyEmail&oobCode=${encodeURIComponent(oobCode)}`,
    { waitUntil: 'domcontentloaded', timeout: 45_000 },
  )
  /**
   * Poll the FACTS, not the URL.
   *
   * A verified first arrival lands on the workspace dashboard and the org is
   * provisioned on the way, so the redirect is real — but it is the last thing
   * to happen, and how long it takes depends on how long the page has had to
   * settle. Waiting on the address bar made this step fail or pass according
   * to how quickly the unrelated `verify-mint` retry loop happened to finish.
   *
   * What actually has to be true is that the account is verified and exactly
   * one org exists. Those are the assertions; the URL is a diagnostic.
   */
  let verified = false
  let orgs = null
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000))
    if (!verified) {
      verified = (await auth.getUser(created.uid)).emailVerified === true
    }
    if (verified) {
      orgs = await db
        .collection('orgs')
        .where('ownerUid', '==', created.uid)
        .get()
      if (orgs.size >= 1) break
    }
  }
  if (!verified) throw new Error('still unverified after redeeming the code')
  if (!orgs || orgs.size === 0) {
    throw new Error(`verified, but no org was provisioned (at ${page.url()})`)
  }
  done(page.url().replace(CONSOLE, ''))

  begin('assert')
  if (orgs.size !== 1) throw new Error(`expected 1 org, found ${orgs.size}`)
  /**
   * Read into locals first, then assign together.
   *
   * `created` is the reaper's worklist and it is read on every path including
   * the failure one, so assigning into it field-by-field around awaits is a
   * genuine race: a throw between the two lines would leave the reaper an org
   * id with no slug, and the slug reservation would survive the cleanup.
   */
  const foundOrgId = orgs.docs[0].id
  const foundSlug = orgs.docs[0].get('slug')
  Object.assign(created, { orgId: foundOrgId, slug: foundSlug })
  // Prefix rather than equality: the product owns how a typed name becomes a
  // workspace address, and this asserts the two things that matter — the org
  // came from THIS walk's name, and it is inside the namespace the orphan
  // sweep is bounded to. An exact match would break on any future slug rule
  // without anything actually being wrong.
  if (!foundSlug || !foundSlug.startsWith(CANARY_SLUG_PREFIX)) {
    throw new Error(`org slug ${foundSlug} is outside the canary namespace`)
  }
  if (!slug.startsWith(foundSlug.slice(0, 20))) {
    throw new Error(`org slug is ${foundSlug}, expected ${slug}`)
  }
  done(`org ${foundOrgId}`)
}

async function main() {
  if (!CONSOLE) throw new Error('SIGNUP_CANARY_ORIGIN is not set')
  if (!EMAIL_BASE) throw new Error('SIGNUP_CANARY_EMAIL is not set')
  if (process.env['SIGNUP_CANARY_ENABLE'] !== '1') {
    console.error(
      'refusing to run: set SIGNUP_CANARY_ENABLE=1 to walk production signup',
    )
    process.exit(2)
  }
  const sa = readServiceAccount()
  if (!sa) throw new Error('admin credentials are not in the environment')

  const app = initializeApp({ credential: cert(sa) }, `canary-${Date.now()}`)
  const db = getFirestore(app)
  const auth = getAuth(app)

  /**
   * Short on purpose. A workspace URL is capped at 30 characters, and the
   * typed organization name becomes the slug — so a stamp long enough to push
   * past the cap gets silently truncated, and the walk then fails asserting
   * its own name back. Base36 plus two bytes keeps `signup-canary-…` at 26.
   */
  const stamp = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
  const [local, domain] = EMAIL_BASE.split('@')
  const identity = {
    email: `${local}-${stamp}@${domain}`,
    password: `Cy-${randomBytes(18).toString('base64url')}-Aa1!`,
    org: `Signup canary ${stamp}`,
    // The typed organization name becomes the slug, so the two must agree or
    // the orphan sweep cannot find what a crashed run left.
    slug: `${CANARY_SLUG_PREFIX}${stamp}`,
  }
  const created = { uid: null, orgId: null, slug: null }

  let failedStep = null
  const { chromium } = require('playwright-core')
  const browser = await chromium.launch({
    executablePath:
      process.env['CHROME_PATH'] ||
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    headless: true,
  })

  try {
    begin('sweep-orphans')
    const swept = await sweepOrphans(db, auth)
    done(swept.length ? `cleared ${swept.length} from a previous run` : '')

    /**
     * ⚠️ THE ONE CARVE-OUT (AGL-2402, allowed for this file only).
     *
     * This project's App Check provider is reCAPTCHA Enterprise, built to
     * score headless automation as a bot — and it does: `accounts:signUp` from
     * this walk is refused `401 Firebase App Check token is invalid` without a
     * debug token. There is no server-side way to mint that attestation.
     *
     * A debug token is a standing bypass, and `app-check-debug-token.spec.ts`
     * exists to stop one becoming live. It allows exactly this file, on two
     * conditions it asserts rather than trusts: that `tools/e2e/` is never
     * imported by app code, so the assignment can never reach a client bundle;
     * and that `appCheckAttestationHealth` still exists.
     *
     * That second one is the important one. A canary attesting with a debug
     * token cannot notice App Check refusing REAL people, so the blindness is
     * covered by measuring `services/verification_count` — every request from
     * every visitor. One canary request an hour against roughly a thousand a
     * day cannot hold that green.
     */
    begin('attest-setup')
    const debugToken = process.env['FIREBASE_APPCHECK_DEBUG_TOKEN'] ?? ''
    if (!debugToken) {
      throw new Error('FIREBASE_APPCHECK_DEBUG_TOKEN is not set')
    }
    // One CONTEXT, so the verification tab shares the signup tab's session and
    // storage the way two tabs of one browser do.
    const context = await browser.newContext()
    // Before any page script: the SDK reads this the moment App Check
    // initializes, and after that it is too late.
    await context.addInitScript((token) => {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = token
    }, debugToken)
    const page = await context.newPage()
    done()

    await walk(page, db, auth, identity, created)
  } catch (error) {
    failedStep = step
    console.log(`FAILED at ${step}: ${String(error).slice(0, 220)}`)
  } finally {
    await browser.close().catch(() => undefined)
  }

  // Always, on every path. A failed walk that leaves residue is two problems.
  begin('reap')
  const missed = await reap(db, auth, created)
  const reapedCleanly = missed.length === 0
  done(reapedCleanly ? 'clean' : `MISSED ${missed.join(', ')}`)

  const elapsedMs = Date.now() - t0
  const ok = failedStep === null

  // The marker the health door reads. Written with the admin SDK rather than
  // through the workspace lib because this runs outside the app; the field
  // names are asserted against the reader by
  // `apps/console/specs/signup-canary-marker-wiring.spec.ts`.
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
