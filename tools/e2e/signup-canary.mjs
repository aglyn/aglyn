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

/**
 * The shortest gap between two real walks.
 *
 * Forty-five minutes, which lands about one walk an hour once GitHub's queue
 * is taken into account, and holds that pace even if the queue suddenly starts
 * honoring every request. Each walk creates and deletes a real account and org
 * on production and sends real mail, so the work rate is a cost that has to be
 * bounded independently of how often the schedule asks.
 */
const MIN_WALK_INTERVAL_MS = 45 * 60 * 1000

/**
 * The firewall bypass every probe in this repo already rides.
 *
 * Bot protection is `challenge`, and it refuses a datacenter IP outright: a
 * real Chrome on a GitHub runner sat on the Vercel Security Checkpoint for
 * 120 seconds and it never cleared. So without this the walk cannot run on a
 * schedule at all, which is the difference between a canary and a script
 * somebody remembers to run.
 *
 * Carrying it is the HOUSE PATTERN, not a new concession: `uptime-probe.yml`
 * rides the same token for every row including the two `front-door/*` ones
 * added to "grade the response the way a visitor experiences it", and
 * `check-external-facts.mjs` and `check-week-one-preflight.mjs` do the same.
 * The edge's behaviour toward an unbypassed visitor is unmonitored across the
 * whole estate — a real gap, and a pre-existing one this canary neither
 * creates nor closes.
 *
 * What it does keep is the distinction that gap deserves: if the checkpoint
 * appears ANYWAY, the walk reports `challenged` rather than pretending the
 * signup form is broken. Same convention the uptime rows use, and for the
 * same reason — a challenge is a statement about the edge, never about the
 * app behind it.
 */
const PROBE_TOKEN = process.env['AGLYN_PROBE_TOKEN'] ?? ''

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
  /**
   * Wait through the edge, not just for the app.
   *
   * The password field, not the shell: bot protection answers with its own
   * page — a Vercel Security Checkpoint — and that page is a 200 (or a 429)
   * carrying no form at all, so waiting for the document proves nothing.
   *
   * But the checkpoint is not a dead end for a BROWSER. It ships a JS
   * challenge, solves it, and navigates on; only a fetch is stuck by it.
   * Measured 2026-09-09 from one machine: `curl` with a headless-Chrome UA
   * got `429 Vercel Security Checkpoint` while playwright on the same host
   * reached the form. So the right behaviour is to keep waiting through the
   * interstitial rather than to treat its appearance as failure — and the
   * first CI run failed here only because a flat 20s wait never allowed for
   * it.
   *
   * If it still has not cleared, say WHAT was on screen. A timeout that
   * reports only "selector not found" sent this investigation the long way
   * round once already.
   */
  const formBy = Date.now() + 120_000
  let sawCheckpoint = false
  let form = null
  while (Date.now() < formBy && !form) {
    form = await page.$('input[name="Passwd"]')
    if (form) break
    const title = await page.title().catch(() => '')
    if (/checkpoint|just a moment|attention required/i.test(title)) {
      sawCheckpoint = true
    }
    await page.waitForTimeout(2_000)
  }
  if (!form) {
    const title = await page.title().catch(() => '(unreadable)')
    if (sawCheckpoint) {
      /**
       * CHALLENGED — a statement about the edge, not about signup.
       *
       * The walk carries the bypass every probe here carries, so reaching this
       * means the bypass itself stopped working: revoked, rotated, or a
       * firewall edit that dropped the rule (which
       * `feedback_vercel_firewall_put_wipes_bot_protection` records happening
       * once already). Naming it separately keeps an on-call reader from
       * hunting a signup bug that is not there.
       */
      throw new Error(
        `challenged — the firewall bypass did not clear bot protection (at ${page.url()})`,
      )
    }
    throw new Error(
      `no signup form after 120s — at ${page.url()}, title ${JSON.stringify(title)}`,
    )
  }
  done(sawCheckpoint ? 'through the checkpoint' : '')

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
   * Poll the FACTS, and grade the RIGHT fact.
   *
   * The claim this canary exists to make is "a stranger can sign up" — an
   * account, created and verified, through the real doors. The workspace is a
   * separate journey, and the product has more than one honest path to it:
   *
   *  - it provisions at verification and lands on the dashboard, or
   *  - it consumes the held name and shows "create your first site", where
   *    "your first site sets up your workspace automatically", or
   *  - it bounces to `/signin`, and the held name survives so the next
   *    sign-in provisions.
   *
   * All three were observed across eight consecutive runs on 2026-09-09. An
   * earlier version of this step asserted "exactly one org exists" and failed
   * two of those eight — not because signup was broken, but because it was
   * grading a step that legitimately varies. A canary that reds on a healthy
   * platform one run in four is worse than no canary; that is the whole
   * lesson of AGL-2714, arriving from the other side.
   *
   * So the verdict is the account. Where the workspace went is recorded as
   * CONTEXT, because it is worth knowing and worth watching — see the note on
   * `outcome` below.
   */
  let verified = false
  const deadline = Date.now() + 90_000
  let nextNudge = Date.now() + 15_000
  while (Date.now() < deadline && !verified) {
    await new Promise((r) => setTimeout(r, 3_000))
    verified = (await auth.getUser(created.uid)).emailVerified === true
    if (!verified && Date.now() > nextNudge) {
      // The page provisions on the first verified session, so a tab that
      // redeemed while its token still said unverified needs a re-read.
      await page
        .reload({ waitUntil: 'domcontentloaded' })
        .catch(() => undefined)
      nextNudge = Date.now() + 15_000
    }
  }
  if (!verified) {
    const seen = (await page.innerText('body').catch(() => ''))
      .replace(/\s+/g, ' ')
      .slice(0, 200)
    throw new Error(
      `redeemed the code and the account is still unverified — at ${page.url()}, screen: ${seen}`,
    )
  }
  done()

  begin('assert')
  /**
   * Which way the workspace went. Not graded — recorded.
   *
   * `signed-out` is the one worth watching: the account is verified and the
   * browser is back at the sign-in page, so the person has to sign in again to
   * reach the workspace their held name still describes. Recoverable, and a
   * rough edge. It happened once in eight runs and nobody has diagnosed it, so
   * it is reported rather than paged on — a canary that reds on an
   * undiagnosed one-in-eight trains people to ignore it.
   */
  const orgs = await db
    .collection('orgs')
    .where('ownerUid', '==', created.uid)
    .get()
  const url = page.url()
  const outcome =
    orgs.size > 0
      ? 'workspace'
      : /\/signin/.test(url)
        ? 'signed-out'
        : 'first-site'
  if (orgs.size > 1) {
    throw new Error(`one signup produced ${orgs.size} workspaces`)
  }
  if (orgs.size === 1) {
    const foundOrgId = orgs.docs[0].id
    const foundSlug = orgs.docs[0].get('slug')
    Object.assign(created, { orgId: foundOrgId, slug: foundSlug })
    if (!foundSlug || !foundSlug.startsWith(CANARY_SLUG_PREFIX)) {
      throw new Error(`org slug ${foundSlug} is outside the canary namespace`)
    }
  }
  done(`account verified, workspace: ${outcome}`)
  return outcome
}

async function main() {
  if (!CONSOLE) throw new Error('SIGNUP_CANARY_ORIGIN is not set')
  if (!EMAIL_BASE) throw new Error('SIGNUP_CANARY_EMAIL is not set')
  // Identity Platform will not reuse an address, so every run needs its own —
  // and this makes one by appending a stamp to the LOCAL PART. Only a
  // plus-address survives that: `zach+canary@x` becomes `zach+canary-a1b2@x`
  // and still reaches the same mailbox, while a bare `canary@x` becomes
  // `canary-a1b2@x`, which no mailbox and no group answers. That is a hard
  // bounce charged to the sending domain on every walk, so it is refused here
  // rather than discovered in the delivery logs.
  if (!EMAIL_BASE.includes('+')) {
    throw new Error(
      `SIGNUP_CANARY_EMAIL must be a plus-address (name+tag@domain); got ${EMAIL_BASE}`,
    )
  }
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
   * Already fresh? Then this run has nothing to prove.
   *
   * The schedule asks far more often than the walk needs to happen, because
   * GitHub serves `schedule` from a best-effort queue and drops most of what
   * it is asked for — measured 2026-09-10, the workflows that got served were
   * the ones asking four and five times an hour, while this one asking twice
   * went four hours untouched (AGL-2723). Asking often is the only lever this
   * side of the API has, so the request rate buys landing odds and this throttle
   * keeps the WORK rate sane: at most one real walk per interval, however many
   * runs GitHub decides to deliver.
   *
   * Only a SUCCESSFUL recent walk skips. After a failure the next run walks
   * immediately, because the question then is whether signup has recovered.
   *
   * Skipping deliberately leaves `walkedAtMs` alone. Touching it would refresh
   * the marker the health door grades and hand back a currency no walk earned,
   * which is the failure this whole check exists to prevent.
   *
   * Fails OPEN: any trouble reading the marker walks rather than skips. A
   * throttle that silently swallowed every run would starve the marker and
   * page for staleness, which is the exact outage it is here to avoid.
   */
  try {
    const prior = (
      await db.collection('rateLimits').doc('signupCanary_production').get()
    ).data()
    const priorAgeMs =
      typeof prior?.walkedAtMs === 'number' ? Date.now() - prior.walkedAtMs : null
    if (prior?.ok === true && priorAgeMs !== null && priorAgeMs < MIN_WALK_INTERVAL_MS) {
      console.log(
        `fresh — last successful walk ${Math.round(priorAgeMs / 60_000)}min ago, ` +
          `under the ${MIN_WALK_INTERVAL_MS / 60_000}min floor; not walking`,
      )
      process.exit(0)
    }
  } catch (error) {
    console.log(`could not read the prior marker, walking: ${String(error).slice(0, 120)}`)
  }

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
  let outcome = null
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
    if (PROBE_TOKEN) {
      /**
       * Scoped to the console, via routing rather than `extraHTTPHeaders`.
       *
       * A context-wide header goes to EVERY origin the page touches —
       * Identity Platform, Firestore, reCAPTCHA — where an unknown header
       * turns simple requests into preflighted ones and the cross-origin
       * calls start failing. Measured: the tab crashed outright, and the walk
       * failed at `account` with "Target page, context or browser has been
       * closed", which names nothing useful.
       *
       * Only requests to the console carry it. That is also the honest scope:
       * the bypass is for OUR firewall, and nobody else's edge should see it.
       */
      await context.route(
        (url) => url.href.startsWith(CONSOLE),
        (route) =>
          route.continue({
            headers: {
              ...route.request().headers(),
              'x-aglyn-probe': PROBE_TOKEN,
            },
          }),
      )
    }
    // Before any page script: the SDK reads this the moment App Check
    // initializes, and after that it is too late.
    await context.addInitScript((token) => {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = token
    }, debugToken)
    const page = await context.newPage()
    done()

    outcome = await walk(page, db, auth, identity, created)
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
      // Context, not a verdict. See the note in `assert`.
      workspaceOutcome: outcome,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })

  console.log(
    `\n${ok && reapedCleanly ? 'PASS' : 'FAIL'} — walk ${elapsedMs}ms` +
      `${failedStep ? `, failed at ${failedStep}` : `, workspace: ${outcome}`}` +
      `${reapedCleanly ? '' : ', LEFT RESIDUE'}`,
  )
  process.exit(ok && reapedCleanly ? 0 : 1)
}

main().catch((error) => {
  console.error(`canary aborted: ${String(error).slice(0, 300)}`)
  process.exit(1)
})
