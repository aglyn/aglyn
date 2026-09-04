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
 * Every probe here is a question whose answer is a known refusal. The mint
 * asks about an address at `.invalid`, a TLD RFC 2606 reserves so it can
 * never be registered; the redemption probes present a code that is not a
 * code. A refusal is the SUCCESS — the same trick the root health check plays
 * on Firestore by reading a document meant to be missing. No org, no site, no
 * user, no email, no slug, nothing metered.
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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { isEmailConfigured } from '@aglyn/shared-util-email'
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
  classifyIdentityToolkitFailure,
  emailVerificationDoorHealth,
  googleOauthDoorHealth,
  passkeyDoorHealth,
  passwordResetDoorHealth,
  ssoDoorHealth,
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

export const emailVerificationProbe = memoizeWithTtl<AuthDoorCheck>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    const [mintVerdict, redemption] = await Promise.all([
      probeVerificationMint(),
      // `accounts:update` is what `applyActionCode` calls — the endpoint that
      // turns a clicked verification link into a verified address.
      probeRedemption('accounts:update'),
    ])
    return emailVerificationDoorHealth(
      { mintVerdict, ...verificationRewrite(), redemption },
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


/** The five checks the route reports, gathered in one place. */
export interface AuthDoorsProbeResult {
  passwordReset: AuthDoorCheck
  emailVerification: AuthDoorCheck
  googleOauth: AuthDoorCheck
  sso: AuthDoorCheck
  passkey: AuthDoorCheck
}

/**
 * One sweep of every door, in parallel.
 *
 * Each probe memoises independently, so a warm one costs nothing and the
 * endpoint's worst case is one round of calls rather than five in series.
 */
export async function probeAuthDoors(): Promise<AuthDoorsProbeResult> {
  const [passwordReset, emailVerification, googleOauth, sso, passkey] =
    await Promise.all([
      passwordResetProbe(),
      emailVerificationProbe(),
      googleOauthProbe(),
      ssoProbe(),
      passkeyProbe(),
    ])
  return { passwordReset, emailVerification, googleOauth, sso, passkey }
}
