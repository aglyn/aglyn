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
 * Reaching the doors — the impure half of `/api/health/auth-doors`
 * (AGL-2586).
 *
 * Separated from the verdicts for the same reason `journeys-probe` is: this
 * talks to Identity Platform, App Check and the GCIP tenant manager, while
 * `auth-doors-verdict` decides. A red-proof that needed production access to
 * run would not be a proof anyone could run, so every branch of the deciding
 * is drivable with no network and no admin credential.
 *
 * ## Nothing is created and no account is touched
 *
 * Every probe that reaches a provider is a question whose answer is a known
 * refusal. The mint asks about an address at `.invalid`, a TLD RFC 2606
 * reserves so it can never be registered; the redemption probes present a code
 * that is not a code. A refusal is the SUCCESS — the same trick the root health
 * check plays on Firestore by reading a document meant to be missing. No org,
 * no site, no user, no email, no slug, nothing metered.
 *
 * The delivery arm (AGL-2673) is the one that asks about real accounts rather
 * than an impossible one, because an OUTCOME cannot be established from a
 * synthetic subject. It still creates nothing and sends nothing: it lists
 * accounts that already exist and reads a log somebody else wrote, and only
 * counts come back out.
 *
 * ## What leaves this file
 *
 * Booleans, counts and members of closed sets. The Identity Platform surfaces
 * behind these calls return the OAuth client secret and the password-hash
 * signer key, a provider error message can carry a project id, and a tenant
 * id names a customer. The response is public; none of it may travel.
 */
import { getApp } from 'firebase-admin/app'
import { getAppCheck } from 'firebase-admin/app-check'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, exactly like the sibling health route.
import {
  consumeVerifyEmailAutoSend,
  firebaseAdmin,
} from '@aglyn/tenant-data-admin'
import { isEmailConfigured } from '@aglyn/shared-util-email'
// From the LEAF rather than the barrel, the rule the delivery log's other
// callers follow: a spec that mocks `@aglyn/tenant-data-admin` wholesale —
// which it must, because that graph reaches the admin SDK — would otherwise
// replace the delivery reader with whatever the factory happened to list, and
// a stub there is a green on the one fact this arm exists to establish.
import { readEmailDeliveryHistory } from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { memoizeWithTtl } from '@aglyn/aglyn/server'

import {
  authActionUrl,
  oobCodeFromLink,
  resolveAuthActionOrigin,
} from '../../_lib/auth-action-url'
import { resolveRpContext } from '../../_lib/passkeys'
import {
  AUTH_DOOR_PROBE_ADDRESS,
  AUTH_DOOR_PROBE_OOB_CODE,
  AUTH_DOOR_PROBE_UID_PREFIX,
  classifyIdentityToolkitFailure,
  emailVerificationDoorHealth,
  googleOauthDoorHealth,
  passkeyDoorHealth,
  PASSWORD_SIGN_IN_EXPECTED_REFUSALS,
  passwordResetDoorHealth,
  passwordSignInDoorHealth,
  ssoDoorHealth,
  MIN_ACCOUNTS_FOR_DELIVERY_VERDICT,
  VERIFICATION_DELIVERY_SETTLE_MINUTES,
  VERIFICATION_DELIVERY_WINDOW_MINUTES,
  verificationDeliveryHealth,
  type AuthDoorCheck,
  type ProviderAnswer,
  type RedemptionAnswer,
} from './auth-doors-verdict'

/**
 * Five minutes, matching the sibling subsystem probes. The uptime workflow
 * samples every fifteen, so this TTL is never the limiting factor for
 * detection latency and it caps what a flood of requests can spend.
 */
export const PROBE_TTL_MS = 5 * 60_000

/**
 * Short enough that a hung provider cannot hold the health endpoint open past
 * a monitor's own timeout. A slow door is a shut door as far as a person
 * trying to sign in is concerned.
 */
const CALL_TIMEOUT_MS = 6_000

/**
 * How many GCIP tenant pools the SSO check samples.
 *
 * Bounded because the number of pools grows with enterprise customers and a
 * public endpoint must not have a cost that grows with the business. Five is
 * enough to distinguish "the provider configs are gone" from "one pool is
 * mid-provisioning".
 */
const SSO_POOL_SAMPLE = 5

/** Overridable so a test can point the whole fetch path at a stub. */
function identityToolkitBase(): string {
  return (
    process.env['IDENTITY_TOOLKIT_API_BASE'] ||
    'https://identitytoolkit.googleapis.com'
  ).replace(/\/+$/, '')
}

/**
 * The App Check token the client-facing Identity Toolkit endpoints require.
 *
 * App Check enforcement is ON for this project, so a browser signing in
 * presents one and a probe that does not is answered 401 — measured, and the
 * reason this exists rather than being skipped. `createToken` is the
 * server-side issuer for exactly this case; the token stays in the process.
 *
 * Failing to mint is NOT fatal here: an install with enforcement off does not
 * need one, and the call is made regardless. If enforcement is on and the
 * token is missing, the provider says so and the verdict reports
 * `appcheck-rejected` — a red for a real reason rather than a guess made in
 * advance.
 */
const appCheckToken = memoizeWithTtl<string | null>(
  30 * 60_000,
  async (): Promise<string | null> => {
    const appId = process.env['NEXT_PUBLIC_FIREBASE_APP_ID']
    if (!appId) return null
    try {
      // Touch the facade so the import above can never be tree-shaken into
      // skipping app initialization.
      void firebaseAdmin
      const minted = await getAppCheck(getApp()).createToken(appId)
      return minted.token
    } catch {
      return null
    }
  },
)

interface ToolkitReply {
  answered: boolean
  status: number
  ok: boolean
  /** Read only to classify. Never returned to a caller, never logged. */
  message: string
  json: Record<string, unknown> | null
}

/**
 * One call to the client-facing Identity Toolkit API, with the public web API
 * key the browser bundle already ships.
 *
 * The key is public by design — it identifies the project, it is not a
 * credential — so using it here adds no secret to the deployment. What it
 * does add is fidelity: this is the same endpoint, the same key and the same
 * App Check precondition a real sign-in goes through, so a configuration
 * change that would break sign-in breaks this first.
 */
async function callIdentityToolkit(
  method: string,
  body: Record<string, unknown>,
): Promise<ToolkitReply> {
  const key = process.env['NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY'] ?? ''
  const token = await appCheckToken()
  const empty: ToolkitReply = {
    answered: false,
    status: 0,
    ok: false,
    message: '',
    json: null,
  }
  if (!key) return empty
  try {
    const response = await fetch(
      `${identityToolkitBase()}/v1/${method}?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Firebase-AppCheck': token } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    )
    let json: Record<string, unknown> | null = null
    try {
      json = (await response.json()) as Record<string, unknown>
    } catch {
      json = null
    }
    const error = json?.['error'] as { message?: string } | undefined
    return {
      answered: true,
      status: response.status,
      ok: response.ok,
      message: String(error?.message ?? ''),
      json,
    }
  } catch {
    // A timeout or a transport failure. `answered: false` is the distinction
    // the verdicts turn on — "the provider refused us" and "nothing replied"
    // need opposite responses.
    return empty
  }
}

/**
 * Present a code that is not a code and require the endpoint to say so.
 *
 * `accounts:resetPassword` redeems a reset code and `accounts:update` redeems
 * a verification code; both answer `INVALID_OOB_CODE` for a synthetic one.
 * That refusal is what proves the second half of the journey — the part that
 * happens after the email arrives, which nothing has ever asserted.
 */
async function probeRedemption(method: string): Promise<RedemptionAnswer> {
  const reply = await callIdentityToolkit(method, {
    oobCode: AUTH_DOOR_PROBE_OOB_CODE,
  })
  if (!reply.answered) {
    return { answered: false, rejectedTheInvalidCode: false }
  }
  if (reply.message.toUpperCase().includes('INVALID_OOB_CODE')) {
    return { answered: true, rejectedTheInvalidCode: true }
  }
  return {
    answered: true,
    rejectedTheInvalidCode: false,
    verdict: classifyIdentityToolkitFailure(reply.status, reply.message),
  }
}

/**
 * Is the console's own origin still one a recovery link may be built on?
 *
 * `resolveAuthActionOrigin` is asked with NO request origin, which is how the
 * recovery routes reach it when a header is absent, so this measures the
 * server-configured answer rather than anything a caller could steer.
 */
function consoleOrigin(): string {
  return resolveAuthActionOrigin('')
}

function originIsAllowlisted(): boolean {
  const origin = consoleOrigin()
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    // A malformed `NEXT_PUBLIC_CONSOLE_URL`. Env vars do go missing and go
    // wrong on deployments of this platform, and this one decides the host
    // in every recovery email.
    return false
  }
  // A reset link is a live credential in transit. Outside development it
  // travels over TLS or it does not travel.
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  // The resolver must still refuse to let a request choose the host. This is
  // the property that keeps a stranger from having us mail somebody a live
  // reset code on a domain the stranger controls.
  return (
    resolveAuthActionOrigin('https://not-an-allowlisted-host.invalid') === origin
  )
}

export const passwordResetProbe = memoizeWithTtl<AuthDoorCheck>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    return passwordResetDoorHealth(
      {
        originAllowlisted: originIsAllowlisted(),
        emailConfigured: isEmailConfigured(),
        redemption: await probeRedemption('accounts:resetPassword'),
      },
      Date.now() - startedAt,
    )
  },
)

/**
 * Ask for a verification link for an address that cannot exist.
 *
 * `auth/user-not-found` is the green: a well-formed refusal proves the
 * credential, the network, the project and the Identity Toolkit API are all
 * working, without minting a redeemable code for anybody. Any other outcome
 * is a fault, and a SUCCESS is the loudest of them — it would mean the
 * reserved address somehow resolved to an account.
 */
async function probeVerificationMint(): Promise<
  'expected-refusal' | 'unexpected-success' | 'unreachable' | 'other-error'
> {
  try {
    await firebaseAdmin
      .app()
      .auth()
      .generateEmailVerificationLink(AUTH_DOOR_PROBE_ADDRESS, {
        url: `${consoleOrigin()}/signin`,
        handleCodeInApp: false,
      })
    return 'unexpected-success'
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? '')
    if (code === 'auth/user-not-found') return 'expected-refusal'
    if (code === 'auth/network-error' || !code) return 'unreachable'
    return 'other-error'
  }
}

/**
 * Does the AGL-1112 rewrite still produce a link the console can redeem?
 *
 * Firebase mints a link on its own `authDomain` and the console rebuilds it
 * onto its own handler page, because the Firebase action handler's
 * configuration is locked and points at a domain the company no longer uses.
 * A drift in that rewriting produces a mail whose button goes nowhere —
 * invisible to the sender, visible only to the person who trusted it. Driven
 * on a synthetic code so nothing redeemable is created.
 */
function verificationRewrite(): {
  linkOnConsoleOrigin: boolean
  linkCarriesCode: boolean
} {
  const origin = consoleOrigin()
  const minted = `${origin}/__/auth/action?mode=verifyEmail&oobCode=${AUTH_DOOR_PROBE_OOB_CODE}`
  const code = oobCodeFromLink(minted)
  if (!code) return { linkOnConsoleOrigin: false, linkCarriesCode: false }
  const rebuilt = authActionUrl(origin, 'verifyEmail', code)
  try {
    const url = new URL(rebuilt)
    return {
      linkOnConsoleOrigin: url.origin === new URL(origin).origin,
      linkCarriesCode: url.searchParams.get('oobCode') === code,
    }
  } catch {
    return { linkOnConsoleOrigin: false, linkCarriesCode: false }
  }
}

/**
 * Is the automatic verification send still allowed to HAPPEN? (AGL-2668)
 *
 * Everything else this door asserts is the provider's: minting answers, the
 * link is rebuilt correctly, redemption refuses a bad code. All of it can be
 * working while no account receives anything, because one gate of our own
 * sits in front of the send — the per-uid cooldown that stops a reopened
 * `/verify-email` tab minting a second link.
 *
 * That gate is the only step whose refusal is invisible. A suppressed
 * automatic send is answered 200 `alreadySent` and renders the ordinary "we
 * sent a verification link" screen, so it produces no error for the account
 * holder to report, no failed request in a console, and no delivery row to be
 * missing from. Asked on a uid nothing has seen before, the cooldown has
 * exactly one correct answer, and any other one means signups are completing
 * into accounts that never get their link.
 *
 * Costs one counter write and read per probe TTL, on a key that expires on
 * its own. It creates no account and sends no mail — the uid is synthetic and
 * belongs to nobody, so the answer is about the gate and never about a person.
 */
async function probeVerificationSendGate(): Promise<
  'admits' | 'suppresses' | 'unavailable'
> {
  const uid = `${AUTH_DOOR_PROBE_UID_PREFIX}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
  try {
    const { allowed } = await consumeVerifyEmailAutoSend(uid)
    return allowed ? 'admits' : 'suppresses'
  } catch {
    // The cooldown answers rather than throws, including when its store is
    // unreachable. Arriving here is the gate itself being broken, which is a
    // different repair from a gate that answers and refuses.
    return 'unavailable'
  }
}

export const emailVerificationProbe = memoizeWithTtl<AuthDoorCheck>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    const [mintVerdict, redemption, sendGate] = await Promise.all([
      probeVerificationMint(),
      // `accounts:update` is what `applyActionCode` calls — the endpoint that
      // turns a clicked verification link into a verified address.
      probeRedemption('accounts:update'),
      probeVerificationSendGate(),
    ])
    return emailVerificationDoorHealth(
      { mintVerdict, ...verificationRewrite(), redemption, sendGate },
      Date.now() - startedAt,
    )
  },
)

/**
 * How long the delivery arm's answer is held.
 *
 * Longer than the five minutes its siblings use, because the window it grades
 * is a DAY: re-asking every five minutes cannot move an answer computed over
 * 1,440 of them, and this is by far the most expensive arm on the endpoint —
 * one admin listing plus one delivery read per sampled account. Fifteen is the
 * uptime workflow's own sampling interval, so at worst a red shows up one
 * sample later than it otherwise would, against a window measured in a day.
 */
const DELIVERY_PROBE_TTL_MS = 15 * 60_000

/**
 * One bounded page of accounts, newest first.
 *
 * Bounded so a large user base costs the same as a small one. When a whole
 * page lands inside the window the count is a FLOOR rather than a total,
 * which can only make the denominator smaller and the verdict quieter —
 * never louder, so it cannot invent an outage.
 */
const ACCOUNTS_QUERY_PAGE = 200

/**
 * The most accounts one verdict looks up in the delivery log.
 *
 * The cost that grows with signup volume is this one, so it is capped well
 * above the floor a verdict needs and well below anything a signup flood
 * could turn into a bill. The newest are sampled, because a live outage shows
 * up in them first.
 */
const VERIFICATION_DELIVERY_SAMPLE = 20

/**
 * The most delivery rows read per address. A brand-new account has one or
 * two; a cap this far above that costs nothing and bounds the pathological
 * case where an address is also on a mailing list.
 */
const DELIVERY_ROWS_PER_ADDRESS = 10

/**
 * The sender label the verification mail carries, stamped as a Resend
 * `context` tag on every send and read back off the webhook event.
 *
 * Matched EXACTLY. A row with no context is one the history import wrote —
 * the provider's list endpoint returns no tags, so an imported row cannot say
 * which sender produced it — and counting it would let an imported receipt
 * pass for a verification mail. Such a row still counts toward
 * `withAnyDelivery`, which is where its evidence actually belongs: it proves
 * the log has something for this person, not what it was.
 */
const VERIFICATION_SEND_CONTEXT = 'email-verification'

/**
 * `VERIFICATION_DELIVERY_MIN_ACCOUNTS` overrides the floor without a code
 * change — the same knob shape the signup checks carry.
 *
 * It is also this arm's forced-failure lever, and like the drought check's it
 * works the opposite way round from a threshold: set it to **0** and every
 * window is graded, so an ordinary quiet one with no accounts in it reports
 * red and the alert path can be proven end to end without breaking mail for
 * anybody. Unset or unparsable means the default.
 */
function configuredMinimumAccounts(): number {
  const raw = process.env['VERIFICATION_DELIVERY_MIN_ACCOUNTS']
  if (!raw) return MIN_ACCOUNTS_FOR_DELIVERY_VERDICT
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : MIN_ACCOUNTS_FOR_DELIVERY_VERDICT
}

/**
 * Is the delivery feed connected on this deployment?
 *
 * The webhook that writes every delivery row refuses to run without this
 * secret and answers `501` instead, so with it unset the log is empty for
 * reasons that have nothing to do with mail. Without this gate the arm would
 * report a total outage on every self-host, every preview deployment and
 * every local run — an alarm that is wrong everywhere except one deployment
 * is an alarm nobody keeps.
 *
 * Read only for PRESENCE, and it is deliberately weak evidence in one
 * direction only: a secret that is set does not prove a webhook is registered
 * with the provider or reaching us, while a secret that is absent does prove
 * nothing can be recorded. That asymmetry is the right way round for a gate
 * whose only job is to keep this arm quiet when its evidence is meaningless.
 */
function deliveryFeedConfigured(): boolean {
  return Boolean(process.env['RESEND_WEBHOOK_SECRET'])
}

/** One account as the Identity Toolkit listing describes it. */
export interface ProbeAccountRecord {
  /** Epoch ms, as a string. */
  createdAt?: string | number
  email?: string
  providerUserInfo?: { providerId?: string }[]
}

/**
 * The accounts a verification mail was OWED to, newest first.
 *
 * Pure, and exported so the window arithmetic and the eligibility rule are
 * driven by a spec rather than by waiting for a quiet Tuesday to disagree
 * with them. Addresses leave this function but never leave the process: they
 * are the key the delivery log is read by, and only counts reach the body.
 *
 * Two filters, and each of them exists to stop a false alarm:
 *
 *  - **the password provider.** An account created through Google arrives
 *    already verified and is never sent a link, and an SSO account lives in
 *    its own per-org pool that this project-level listing does not return at
 *    all. Counting either in the denominator would manufacture a drought out
 *    of mail that was correctly never sent.
 *  - **the settle margin.** The window ENDS `settleMinutes` in the past. A
 *    delivery row is written by a provider webhook, so an account created a
 *    minute ago has no row yet and grading it would report an outage every
 *    time somebody signs up.
 *
 * Verification state is deliberately NOT a filter. An account that has since
 * verified still received the mail, and dropping it would leave a denominator
 * made only of accounts that had not clicked yet — which is the numerator's
 * complement, not its denominator.
 */
export function accountsOwedVerificationMail(
  records: readonly ProbeAccountRecord[] | null | undefined,
  nowMs: number,
  options?: { windowMinutes?: number; settleMinutes?: number },
): string[] {
  const windowMinutes =
    options?.windowMinutes ?? VERIFICATION_DELIVERY_WINDOW_MINUTES
  const settleMinutes =
    options?.settleMinutes ?? VERIFICATION_DELIVERY_SETTLE_MINUTES
  const endsAt = nowMs - settleMinutes * 60_000
  const startsAt = endsAt - windowMinutes * 60_000
  const owed: { at: number; email: string }[] = []
  for (const record of records ?? []) {
    // `Number(...)` on a field the provider sends as a string, and a
    // non-finite one is dropped BEFORE the bounds rather than by them: NaN
    // compares false against both, so a corrupt record would sail through the
    // window test and be counted as a signup that never happened.
    const at = Number(record?.createdAt)
    if (!Number.isFinite(at) || at <= 0) continue
    if (at > endsAt || at < startsAt) continue
    const email = String(record?.email ?? '').trim()
    if (!email) continue
    const hasPassword = (record?.providerUserInfo ?? []).some(
      (provider) => provider?.providerId === 'password',
    )
    if (!hasPassword) continue
    owed.push({ at, email })
  }
  // Newest first, so the sample below is the freshest evidence rather than
  // whatever order the provider happened to answer in.
  owed.sort((a, b) => b.at - a.at)
  return owed.map((entry) => entry.email)
}

/**
 * The accounts listing, with "this deployment cannot list accounts" kept
 * separate from "the listing failed".
 *
 * The two need opposite answers and the distinction is the whole reason this
 * shape exists: an install with no admin credential has nothing to grade and
 * must not be reported as an outage, while a credential that is present and
 * then cannot mint a token, or a call that is refused, is exactly the state
 * somebody should look at.
 */
interface AccountListing {
  /** False only when there is no credential or no project id to use at all. */
  configured: boolean
  /** Null when the listing was attempted and did not answer. */
  records: ProbeAccountRecord[] | null
}

/**
 * One newest-first page of Identity Toolkit accounts.
 *
 * The same call `check-funnel-conversions.mjs` makes, for the same reason: it
 * reads account creation from the system of record, with no processing lag,
 * no consent gate and no analytics vendor in the path.
 *
 * ⚠️ The success body carries EVERY account's address and password hash. It
 * is never logged, never summarised and never returned — the addresses are
 * used in-process as delivery-log keys and nothing but counts leaves.
 */
async function listRecentAccounts(): Promise<AccountListing> {
  let projectId: string | undefined
  let token: string | undefined
  let credentialPresent = false
  try {
    // `getApp()`, not the facade: the facade narrows the app to its accessors
    // and drops `options`, which is where the credential and the project id
    // live. Same acquisition path the lockdown trigger read uses.
    void firebaseAdmin
    const app = getApp()
    projectId = (app.options?.projectId ??
      process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']) as string | undefined
    const credential = app.options?.credential
    credentialPresent = Boolean(credential && projectId)
    token = (await credential?.getAccessToken?.())?.access_token
  } catch {
    token = undefined
  }
  // Nothing to list WITH. The only silent state on this arm, and it is narrow
  // on purpose: a credential that exists and then fails to mint falls through
  // to `records: null`, which is degraded.
  if (!credentialPresent) return { configured: false, records: null }
  if (!token) return { configured: true, records: null }
  try {
    const response = await fetch(
      `${identityToolkitBase()}/v1/projects/${encodeURIComponent(
        projectId,
      )}/accounts:query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          returnUserInfo: true,
          sortBy: 'CREATED_AT',
          order: 'DESC',
          limit: ACCOUNTS_QUERY_PAGE,
        }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    )
    if (!response.ok) return { configured: true, records: null }
    const payload = (await response.json()) as {
      userInfo?: ProbeAccountRecord[]
    }
    return { configured: true, records: payload?.userInfo ?? [] }
  } catch {
    return { configured: true, records: null }
  }
}

/** What the delivery log knows about a sample of addresses. */
interface DeliveryTally {
  sampled: number
  withVerificationDelivery: number
  withAnyDelivery: number
  /** True when a read FAILED, which is not the same as coming back empty. */
  unreadable: boolean
}

const NO_DELIVERIES_READ: DeliveryTally = {
  sampled: 0,
  withVerificationDelivery: 0,
  withAnyDelivery: 0,
  unreadable: false,
}

/**
 * How many of these people have a delivery event, and how many have any mail
 * recorded at all.
 *
 * `readEmailDeliveryHistory` rather than the plain reader, because it keeps a
 * failed read apart from an empty one — and those lead to opposite verdicts
 * here for the same reason they lead a staffer to opposite next actions.
 *
 * In parallel and over a capped sample: the endpoint is public, so its cost
 * is bounded by the cap and by the probe memo rather than by how many people
 * signed up today.
 */
async function tallyVerificationDeliveries(
  addresses: readonly string[],
): Promise<DeliveryTally> {
  const sample = addresses.slice(0, VERIFICATION_DELIVERY_SAMPLE)
  if (sample.length === 0) return NO_DELIVERIES_READ
  const reads = await Promise.all(
    sample.map((address) =>
      readEmailDeliveryHistory(address, { limit: DELIVERY_ROWS_PER_ADDRESS }),
    ),
  )
  let withVerificationDelivery = 0
  let withAnyDelivery = 0
  let unreadable = false
  for (const read of reads) {
    if (read.lookupFailed) {
      unreadable = true
      continue
    }
    if (read.rows.length > 0) withAnyDelivery += 1
    if (read.rows.some((row) => row.context === VERIFICATION_SEND_CONTEXT)) {
      withVerificationDelivery += 1
    }
  }
  return {
    sampled: sample.length,
    withVerificationDelivery,
    withAnyDelivery,
    unreadable,
  }
}

/**
 * The outcome arm: did the mail this door lets be SENT actually get recorded
 * as delivered? (AGL-2673)
 *
 * Reads nothing a person could steer and writes nothing at all — one admin
 * listing of accounts that already exist, and one delivery-log read per
 * sampled address.
 */
export const verificationDeliveryProbe = memoizeWithTtl<AuthDoorCheck>(
  DELIVERY_PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    const feedConfigured = deliveryFeedConfigured()
    const listing = await listRecentAccounts()
    const owed =
      listing.records === null
        ? null
        : accountsOwedVerificationMail(listing.records, Date.now())
    // No delivery reads when nothing could have recorded an answer, and none
    // when there is no address to ask about. Both are states the verdict
    // already decides on the counts it has.
    const tally =
      feedConfigured && owed !== null
        ? await tallyVerificationDeliveries(owed)
        : NO_DELIVERIES_READ
    return verificationDeliveryHealth(
      {
        accountListingConfigured: listing.configured,
        deliveryFeedConfigured: feedConfigured,
        accountsCreated: owed === null ? null : owed.length,
        accountsSampled: tally.sampled,
        withVerificationDelivery: tally.withVerificationDelivery,
        withAnyDelivery: tally.withAnyDelivery,
        deliveryLogUnreadable: tally.unreadable,
        minimumAccounts: configuredMinimumAccounts(),
        windowMinutes: VERIFICATION_DELIVERY_WINDOW_MINUTES,
        settleMinutes: VERIFICATION_DELIVERY_SETTLE_MINUTES,
      },
      Date.now() - startedAt,
    )
  },
)

export const googleOauthProbe = memoizeWithTtl<AuthDoorCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  // The first step of a real Google sign-in: ask Identity Platform to build
  // the authorization URL for our origin. It answers from the same provider
  // config and the same authorized-domain list the browser handshake uses.
  const reply = await callIdentityToolkit('accounts:createAuthUri', {
    providerId: 'google.com',
    continueUri: `${consoleOrigin()}/signin`,
  })
  const answer: ProviderAnswer = reply.answered
    ? {
        answered: true,
        verdict: reply.ok
          ? 'accepted'
          : classifyIdentityToolkitFailure(reply.status, reply.message),
      }
    : { answered: false, verdict: 'refused' }
  let authUriOnGoogle = false
  let carriesClientId = false
  const authUri = String(reply.json?.['authUri'] ?? '')
  if (authUri) {
    try {
      const url = new URL(authUri)
      authUriOnGoogle = url.hostname.endsWith('.google.com')
      // Presence only. The client id is not a secret, but nothing read out of
      // a provider response gets to travel into a public body.
      carriesClientId = Boolean(url.searchParams.get('client_id'))
    } catch {
      authUriOnGoogle = false
    }
  }
  return googleOauthDoorHealth(
    { answer, authUriOnGoogle, carriesClientId },
    Date.now() - startedAt,
  )
})

/**
 * SSO creates into a per-org GCIP tenant pool, never the project pool
 * (AGL-1122), so the thing to watch is the tenant manager and the provider
 * configs inside a bounded sample of pools.
 *
 * COUNTS ONLY leave this function. A tenant id, an org name or a provider id
 * identifies a customer, and this endpoint is public.
 */
export const ssoProbe = memoizeWithTtl<AuthDoorCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  try {
    const manager = firebaseAdmin.app().auth().tenantManager()
    const listed = await manager.listTenants(SSO_POOL_SAMPLE)
    const pools = listed.tenants ?? []
    let poolsWithEnabledProvider = 0
    for (const pool of pools) {
      const tenantAuth = manager.authForTenant(pool.tenantId)
      const [saml, oidc] = await Promise.all([
        tenantAuth
          .listProviderConfigs({ type: 'saml', maxResults: 5 })
          .catch(() => ({ providerConfigs: [] })),
        tenantAuth
          .listProviderConfigs({ type: 'oidc', maxResults: 5 })
          .catch(() => ({ providerConfigs: [] })),
      ])
      const enabled = [...saml.providerConfigs, ...oidc.providerConfigs].some(
        (config) => config.enabled,
      )
      if (enabled) poolsWithEnabledProvider += 1
    }
    return ssoDoorHealth(
      {
        poolCount: pools.length,
        sampledPools: pools.length,
        poolsWithEnabledProvider,
      },
      Date.now() - startedAt,
    )
  } catch {
    // Null is degraded by contract. An alarm that cannot see the thing it
    // watches must not report calm — the rule the signup counter follows, and
    // the error is dropped because it can carry a project id.
    return ssoDoorHealth(
      { poolCount: null, sampledPools: 0, poolsWithEnabledProvider: 0 },
      Date.now() - startedAt,
    )
  }
})

export const passkeyProbe = memoizeWithTtl<AuthDoorCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  // The console's own origin, through the same gate every ceremony passes.
  // A deployment whose workspace domain is wrong fails here and nowhere else.
  const rp = resolveRpContext(consoleOrigin())
  if (!rp) {
    return passkeyDoorHealth(
      { rpContextResolved: false, challengeIssued: false },
      Date.now() - startedAt,
    )
  }
  let challengeIssued: boolean
  try {
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      userVerification: 'preferred',
      allowCredentials: [],
    })
    challengeIssued = Boolean(options.challenge)
  } catch {
    challengeIssued = false
  }
  // Nothing is stored. The real sign-in route persists the challenge so it
  // can be consumed once; a probe that wrote one would be manufacturing
  // documents a public endpoint could be made to flood.
  return passkeyDoorHealth(
    { rpContextResolved: true, challengeIssued },
    Date.now() - startedAt,
  )
})


/**
 * A password sent for an account that does not exist (AGL-2583).
 *
 * It is not a secret and guards nothing — the address is refused long before
 * a password is compared — but it has to be long enough that the request is
 * rejected for its subject rather than for its shape.
 */
const ABSENT_ACCOUNT_PASSWORD = 'probe-not-a-credential-0000'

/**
 * The disposable probe identity, or null when this deployment has none.
 *
 * Both halves must be present. One without the other is a half-configured
 * probe, and a half-configured probe that reported red would make every
 * deployment with a typo look like a sign-in outage. The credential lives in
 * the deployment's own secret store, never in this repository — the rule
 * `AGLYN_PROBE_TOKEN` already follows; `docs/UPTIME_AND_SLA.md` carries the
 * setup, including that the identity must own nothing.
 */
function signInProbeIdentity(): { email: string; password: string } | null {
  const email = process.env['AGLYN_SIGNIN_PROBE_EMAIL']?.trim()
  const password = process.env['AGLYN_SIGNIN_PROBE_PASSWORD']
  if (!email || !password) return null
  return { email, password }
}

export const passwordSignInProbe = memoizeWithTtl<AuthDoorCheck>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    // The same endpoint, the same public key and the same App Check
    // precondition a real sign-in goes through, asked about an address in a
    // reserved TLD. The refusal is the success.
    const reply = await callIdentityToolkit('accounts:signInWithPassword', {
      email: AUTH_DOOR_PROBE_ADDRESS,
      password: ABSENT_ACCOUNT_PASSWORD,
      returnSecureToken: true,
    })
    const message = reply.message.toUpperCase()
    const refusedTheAbsentAccount = PASSWORD_SIGN_IN_EXPECTED_REFUSALS.some(
      (expected) => message.includes(expected),
    )
    const answer: ProviderAnswer = reply.answered
      ? {
          answered: true,
          verdict:
            reply.ok || refusedTheAbsentAccount
              ? 'accepted'
              : classifyIdentityToolkitFailure(reply.status, reply.message),
        }
      : { answered: false, verdict: 'refused' }

    // Sequential, not parallel: two sign-ins arriving together from one
    // address — one of them failing — is the shape Identity Platform
    // throttles, and a monitor that trips the defense it is watching reports
    // its own noise.
    const identity = signInProbeIdentity()
    let probe: { signedIn: boolean } | null = null
    if (identity) {
      const credentialed = await callIdentityToolkit(
        'accounts:signInWithPassword',
        {
          email: identity.email,
          password: identity.password,
          returnSecureToken: true,
        },
      )
      // A token is the only proof the sign-in happened. It is read for its
      // presence and never stored, logged or returned.
      probe = {
        signedIn:
          credentialed.ok &&
          typeof credentialed.json?.['idToken'] === 'string',
      }
    }

    return passwordSignInDoorHealth(
      {
        answer,
        refusedTheAbsentAccount,
        unexpectedAcceptance: reply.answered && reply.ok,
        probe,
      },
      Date.now() - startedAt,
    )
  },
)

/** The seven checks the route reports, gathered in one place. */
export interface AuthDoorsProbeResult {
  passwordSignIn: AuthDoorCheck
  passwordReset: AuthDoorCheck
  emailVerification: AuthDoorCheck
  verificationDelivery: AuthDoorCheck
  googleOauth: AuthDoorCheck
  sso: AuthDoorCheck
  passkey: AuthDoorCheck
}

/**
 * One sweep of every door, in parallel.
 *
 * Each probe memoises independently, so a warm one costs nothing and the
 * endpoint's worst case is one round of calls rather than six in series.
 */
export async function probeAuthDoors(): Promise<AuthDoorsProbeResult> {
  const [
    passwordSignIn,
    passwordReset,
    emailVerification,
    verificationDelivery,
    googleOauth,
    sso,
    passkey,
  ] = await Promise.all([
    passwordSignInProbe(),
    passwordResetProbe(),
    emailVerificationProbe(),
    verificationDeliveryProbe(),
    googleOauthProbe(),
    ssoProbe(),
    passkeyProbe(),
  ])
  return {
    passwordSignIn,
    passwordReset,
    emailVerification,
    verificationDelivery,
    googleOauth,
    sso,
    passkey,
  }
}
