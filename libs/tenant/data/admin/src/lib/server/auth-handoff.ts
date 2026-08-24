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

import { createHash, randomBytes } from 'crypto'
import { safeSameOriginPath } from '@aglyn/shared-util-http/safe-redirect'
import firebaseAdmin from './firebase-admin'
import { consumeOnce } from './consume-once'
import {
  CONSOLE_DOMAINS_COLLECTION,
  normalizeConsoleDomain,
  resolveConsoleDomain,
} from './console-domains'
import { safeEqual } from './safe-equal'

/**
 * Cross-domain console session handoff — the 1099e mechanism (AGL-1902),
 * built to `docs/design/agl-1099a-cross-domain-session-handoff.md`.
 *
 * ## The problem
 *
 * The console's session cookie is minted with `Domain=.aglyn.com`, which is
 * why workspace subdomains can delegate interactive sign-in to
 * `auth.aglyn.com` and pick the session back up. `console.acme-agency.com`
 * shares no parent domain, so that mechanism is not merely inconvenient there,
 * it is unavailable. A custom console domain needs its own first-party
 * session, bootstrapped by a hand-off from the auth host.
 *
 * ## Threat model
 *
 * The credential in flight would, if stolen, be a full session on someone
 * else's account. Four attacks, and what refuses each:
 *
 * 1. **The return secret leaks** — our own edge access logs, a log drain, a
 *    `Referer` on a subresource, a shoulder. Useless alone: redemption also
 *    requires the VERIFIER, which lives only in an `HttpOnly` cookie the
 *    custom domain set on the browser that started the flow. (The secret is
 *    additionally carried in the URL FRAGMENT, which is never transmitted to
 *    any server — so the one channel we own and cannot audit never sees it.)
 * 2. **The attacker starts a flow and phishes the victim into finishing it**,
 *    so the attacker holds the verifier. Useless: the secret is delivered only
 *    to the browser that completed sign-in — the victim's.
 * 3. **The attacker replays a redemption.** Refused by {@link consumeOnce}: the
 *    record is read and mutated in one serializable transaction, so a second
 *    consume finds `redeemed` whatever the outcome of the first, and two
 *    concurrent redemptions cannot both commit.
 * 4. **The attacker redeems at their own origin**, or points a domain they
 *    genuinely own at us. Refused twice over: the record names its
 *    `targetHost` at initiation and redemption requires the request's own
 *    `Host` to match, and — the load-bearing one —
 *    {@link authorizeConsoleHandoff} refuses unless the signed-in user is a
 *    MEMBER of the org that owns the target host. Verified-domain status is
 *    not sufficient. A victim phished onto `console.aglyn-support.com` signs
 *    in on the genuine auth host, their credential never touches the
 *    attacker's origin, and they are told they have no access to that
 *    workspace.
 *
 * The token itself is opaque random bytes with a stored SHA-256, following
 * `hashApiKey`/`generateApiKeyToken` — not a signed claims blob. Single use
 * requires a server-side record, and once the record exists a signature buys
 * nothing and adds a key to keep in step across two Vercel projects.
 *
 * ## Two windows, because they answer different questions
 *
 * `pending` gets 15 minutes: the user may type a password, do MFA, verify an
 * email, and a pending record grants nothing. `authorized` gets 120 seconds:
 * one `location.replace` and one same-origin POST. Anything slower is a broken
 * flow, not a slow user.
 *
 * **Clock skew is not a threat here and the reason is structural: no timestamp
 * originates in a browser.** Both legs run on our own serverless runtime and
 * compare against a value another instance of the same runtime wrote. There is
 * no skew-tolerance parameter to tune, and adding one would only widen the
 * replay window.
 *
 * ## Not built here, and deliberately
 *
 * Staff impersonation is refused at authorize. A staff session on
 * customer-controlled infrastructure is a credential sitting on someone else's
 * server, and support can use `{slug}.aglyn.com`, which works today.
 */

const firestore = () => firebaseAdmin.app().firestore()

/** Firestore collection holding pending/authorized handoffs. */
export const AUTH_HANDOFFS_COLLECTION = 'authHandoffs'

/** Name of the host-only verifier cookie the custom domain sets. */
export const HANDOFF_VERIFIER_COOKIE = '__aglyn_handoff'

/** initiate → authorize. Generous; a pending record grants nothing. */
export const HANDOFF_PENDING_TTL_MS = 15 * 60 * 1000

/** authorize → redeem. One navigation and one same-origin POST. */
export const HANDOFF_AUTHORIZED_TTL_MS = 120 * 1000

export type HandoffStatus = 'pending' | 'authorized' | 'redeemed'

/** SHA-256 hex, the same shape `hashApiKey` stores. */
export function hashHandoffSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** 32 random bytes, base64url — opaque, and carrying nothing to lie about. */
function newSecret(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * A `continuePath` that cannot leave the custom domain.
 *
 * The handoff lands the user somewhere immediately after signing them in,
 * which is the worst possible moment to hand control to an attacker-chosen
 * origin — so this defers to {@link safeSameOriginPath}, which resolves the
 * value and compares origins instead of testing its shape (AGL-1881).
 *
 * This function used to reject `//evil.example` and `/\evil.example` by
 * inspecting the characters. That list read as complete and was not: the URL
 * parser deletes tab, LF and CR before parsing, so `/<TAB>/evil.example`
 * contains neither `//` nor `\` and still resolves to `https://evil.example/`.
 * Enumerating tricks is the bug; asking the parser is the fix.
 */
export function safeContinuePath(input: string | null | undefined): string {
  return safeSameOriginPath(input, '/')
}

export interface StartedHandoff {
  requestId: string
  /** `V` — goes in the custom domain's own host-only cookie. */
  verifier: string
  expiresAtMs: number
}

/**
 * Create a `pending` handoff for `targetHost`, returning the id and verifier.
 *
 * Called on the custom domain, unauthenticated: nothing about a pending record
 * is a capability. It names the host the request actually arrived on — never a
 * host from a parameter — which is what makes the `targetHost` check at
 * redemption mean anything.
 */
export async function startConsoleHandoff(options: {
  targetHost: string
  orgSlug: string | null
  continuePath?: string | null
  nowMs?: number
}): Promise<StartedHandoff | null> {
  const targetHost = normalizeConsoleDomain(options.targetHost)
  if (!targetHost) return null
  const nowMs = options.nowMs ?? Date.now()
  const requestId = crypto.randomUUID()
  const verifier = newSecret()
  const expiresAtMs = nowMs + HANDOFF_PENDING_TTL_MS
  await firestore()
    .collection(AUTH_HANDOFFS_COLLECTION)
    .doc(requestId)
    .set({
      targetHost,
      orgSlug: options.orgSlug ?? null,
      continuePath: safeContinuePath(options.continuePath),
      verifierHash: hashHandoffSecret(verifier),
      secretHash: null,
      status: 'pending' satisfies HandoffStatus,
      uid: null,
      tenantId: null,
      createdAt: nowMs,
      // A Firestore `Timestamp`, matching the idiom in `passkeys.ts` and
      // `rate-limit-store.ts`. TTL deletion is best-effort within ~72h, so
      // EXPIRY IS ENFORCED IN CODE and the TTL policy is hygiene only —
      // never the other way round.
      expiresAt: new Date(expiresAtMs),
    })
  return { requestId, verifier, expiresAtMs }
}

export type AuthorizeRefusal =
  | 'unknown-request'
  | 'not-pending'
  | 'expired'
  | 'host-mismatch'
  | 'domain-inactive'
  | 'not-a-member'
  | 'impersonation'

export type AuthorizeResult =
  | {
      ok: true
      /** `S` — goes in the return URL's FRAGMENT, never its query. */
      secret: string
      targetHost: string
      continuePath: string
    }
  | { ok: false; reason: AuthorizeRefusal; orgSlug: string | null }

/**
 * Authorize a pending handoff, on the AUTH HOST, for a signed-in user.
 *
 * `isMember` is injected rather than resolved here so this module stays free
 * of the membership model, and so the test can exercise the refusal without a
 * membership fixture. It receives the target host as well as the slug because
 * the ORG ID lives on the claim and `resolveConsoleDomain` deliberately never
 * returns it — a verdict is read by an unauthenticated route. It is called
 * only after the domain has been shown to be live, so a refusal never reveals
 * whether an org exists.
 *
 * The write flips `pending → authorized` inside {@link consumeOnce}, so a
 * second authorize of the same id finds `not-pending`. That matters: without
 * it, an attacker who obtained a request id could keep re-authorizing it and
 * mint a fresh secret each time the victim signed in.
 */
export async function authorizeConsoleHandoff(options: {
  requestId: string
  uid: string
  tenantId?: string | null
  impersonated?: boolean
  isMember: (context: {
    targetHost: string
    orgSlug: string | null
  }) => Promise<boolean>
  nowMs?: number
}): Promise<AuthorizeResult> {
  const nowMs = options.nowMs ?? Date.now()
  const requestId = options.requestId
  if (!requestId || requestId.includes('/')) {
    return { ok: false, reason: 'unknown-request', orgSlug: null }
  }
  const ref = firestore().collection(AUTH_HANDOFFS_COLLECTION).doc(requestId)

  // Read first, only to answer the questions that need an AWAIT — domain
  // liveness and membership — because neither can be performed inside a
  // transaction. Every check that can race is re-made inside `consumeOnce`
  // below, against the state it reads for itself.
  let peek: FirebaseFirestore.DocumentSnapshot
  try {
    peek = await ref.get()
  } catch {
    return { ok: false, reason: 'unknown-request', orgSlug: null }
  }
  if (!peek.exists) return { ok: false, reason: 'unknown-request', orgSlug: null }
  const targetHost = String(peek.get('targetHost') ?? '')
  const orgSlug = (peek.get('orgSlug') as string | null) ?? null

  // Staff impersonation over a custom console domain is refused outright
  // (AGL-1353 §8.15). A staff session on customer-controlled infrastructure is
  // a credential sitting on someone else's server; support uses the workspace
  // subdomain, which works today.
  if (options.impersonated) {
    return { ok: false, reason: 'impersonation', orgSlug }
  }

  const verdict = await resolveConsoleDomain(targetHost)
  // `degraded` refuses here, unlike the routing gate. Routing fails OPEN
  // because a console going dark on a timeout is worse than the residual
  // exposure; MINTING A SESSION on a domain we could not confirm is live is
  // the opposite trade, and the user still has a working
  // `{slug}.aglyn.com` to fall back to.
  if (!verdict.servable) {
    return { ok: false, reason: 'domain-inactive', orgSlug: verdict.orgSlug }
  }

  // THE check. Verified custom-domain status is not sufficient — an attacker
  // can verify a domain they genuinely own. Membership in the org that owns
  // the target host is what makes the feature safe to sell, and it is the
  // first thing a reviewer should look for.
  if (!(await options.isMember({ targetHost, orgSlug: verdict.orgSlug }))) {
    return { ok: false, reason: 'not-a-member', orgSlug: verdict.orgSlug }
  }

  const secret = newSecret()
  const consumed = await consumeOnce<{ continuePath: string }>(
    firestore(),
    ref,
    (data) => {
      if (data['status'] !== 'pending') {
        return { accept: false, reason: 'not-pending' }
      }
      if (String(data['targetHost'] ?? '') !== targetHost) {
        return { accept: false, reason: 'host-mismatch' }
      }
      const createdAt = Number(data['createdAt'] ?? 0)
      if (!createdAt || nowMs - createdAt > HANDOFF_PENDING_TTL_MS) {
        return { accept: false, reason: 'expired' }
      }
      return {
        accept: true,
        value: { continuePath: String(data['continuePath'] ?? '/') },
        patch: {
          status: 'authorized' satisfies HandoffStatus,
          secretHash: hashHandoffSecret(secret),
          uid: options.uid,
          tenantId: options.tenantId ?? null,
          authorizedAt: nowMs,
          // The window shortens the moment it is authorized: 120 s, not the
          // remainder of the pending 15 minutes.
          expiresAt: new Date(nowMs + HANDOFF_AUTHORIZED_TTL_MS),
        },
      }
    },
  )
  if (!consumed.ok) {
    const reason = consumed.reason
    return {
      ok: false,
      reason:
        reason === 'absent'
          ? 'unknown-request'
          : (reason as AuthorizeRefusal) ?? 'unknown-request',
      orgSlug: verdict.orgSlug,
    }
  }
  return {
    ok: true,
    secret,
    targetHost,
    continuePath: consumed.value?.continuePath ?? '/',
  }
}

export type RedeemRefusal =
  | 'unknown-request'
  | 'already-redeemed'
  | 'not-authorized'
  | 'expired'
  | 'host-mismatch'
  | 'bad-secret'
  | 'bad-verifier'
  | 'domain-inactive'
  | 'revoked'

export type RedeemResult =
  | { ok: true; uid: string; tenantId: string | null; continuePath: string }
  | { ok: false; reason: RedeemRefusal }

/**
 * Consume an authorized handoff, on the CUSTOM DOMAIN.
 *
 * Both secrets are required and both are checked INSIDE the transaction, so
 * the checks cannot be raced against the consume.
 *
 * `verifiers` is every value of the `__aglyn_handoff` cookie on the request,
 * not one. A compromised sibling host under the customer's own apex can set a
 * `Domain=.acme-agency.com` cookie of the same name, which SHADOWS the
 * host-only one in the `Cookie` header with no way to tell them apart — the
 * precise failure AGL-1259 hit with duplicate `__session` cookies. Hashing
 * every value and accepting if any matches is safe by construction (only the
 * real `V` hashes to `verifierHash`) and turns a hijack attempt into a no-op
 * rather than a denial of service.
 */
export async function redeemConsoleHandoff(options: {
  requestId: string
  secret: string
  verifiers: string[]
  requestHost: string
  nowMs?: number
}): Promise<RedeemResult> {
  const nowMs = options.nowMs ?? Date.now()
  const requestId = options.requestId
  if (!requestId || requestId.includes('/')) {
    return { ok: false, reason: 'unknown-request' }
  }
  const requestHost = normalizeConsoleDomain(options.requestHost)
  if (!requestHost) return { ok: false, reason: 'host-mismatch' }

  // Liveness and revocation, both of which need an AWAIT and so cannot live
  // inside the transaction. D6 requires BOTH legs of the session to honour the
  // epoch — "the redemption endpoint and the `GET` exchange" — and this leg is
  // the one that had neither check.
  //
  // It matters because `/api/*` sits OUTSIDE the middleware matcher, so
  // `serveConsoleDomain` never sees this route: a suspended or detached domain
  // is refused a console to render and was still handed a working redemption.
  // And the `GET` exchange cannot cover for it, because the credential a
  // redemption mints is NEWER than the bump that was supposed to kill it — an
  // epoch can only refuse a cookie it predates.
  const verdict = await resolveConsoleDomain(requestHost)
  // `degraded` refuses here, for `authorize`'s reason: routing fails OPEN
  // because a console going dark on a timeout is worse than the residual
  // exposure, but MINTING a session on a domain we could not confirm is live is
  // the opposite trade, and the user still has `{slug}.aglyn.com` to fall back
  // to.
  if (!verdict.servable) return { ok: false, reason: 'domain-inactive' }
  const epoch = await readConsoleSessionEpoch(requestHost)

  const ref = firestore().collection(AUTH_HANDOFFS_COLLECTION).doc(requestId)

  const consumed = await consumeOnce<{
    uid: string
    tenantId: string | null
    continuePath: string
  }>(firestore(), ref, (data) => {
    const status = data['status']
    if (status === 'redeemed') {
      return { accept: false, reason: 'already-redeemed' }
    }
    if (status !== 'authorized') {
      return { accept: false, reason: 'not-authorized' }
    }
    // Origin binding, half one: the record names its target and redemption
    // requires the request's OWN host to match. Half two — the verifier below
    // — is the load-bearing one, because an unbound token is a theft primitive
    // even when the attacker controls no domain at all: they would simply POST
    // it to our own redemption endpoint from their own machine.
    if (String(data['targetHost'] ?? '') !== requestHost) {
      return { accept: false, reason: 'host-mismatch' }
    }
    const authorizedAt = Number(data['authorizedAt'] ?? 0)
    if (!authorizedAt || nowMs - authorizedAt > HANDOFF_AUTHORIZED_TTL_MS) {
      return { accept: false, reason: 'expired' }
    }
    // D7 orders a detach `sessionEpoch = now` FIRST, then the Vercel delete,
    // precisely so sessions die while we still control the host. An
    // authorization that predates the bump is one of those sessions, and it is
    // refused WITHOUT a write: `consumeOnce` does not destroy a refused record
    // by default, so this cannot be used to knock out a concurrent legitimate
    // redemption.
    if (epoch > 0 && authorizedAt < epoch) {
      return { accept: false, reason: 'revoked' }
    }
    if (!safeEqual(hashHandoffSecret(options.secret), String(data['secretHash'] ?? ''))) {
      return { accept: false, reason: 'bad-secret' }
    }
    const verifierHash = String(data['verifierHash'] ?? '')
    const verifierOk = options.verifiers.some((candidate) =>
      safeEqual(hashHandoffSecret(candidate), verifierHash),
    )
    if (!verifierOk) return { accept: false, reason: 'bad-verifier' }
    return {
      accept: true,
      value: {
        uid: String(data['uid'] ?? ''),
        tenantId: (data['tenantId'] as string | null) ?? null,
        continuePath: String(data['continuePath'] ?? '/'),
      },
      patch: {
        status: 'redeemed' satisfies HandoffStatus,
        redeemedAt: nowMs,
        // Nothing that could re-authorize it survives the consume.
        secretHash: null,
        verifierHash: null,
      },
    }
  })

  if (!consumed.ok || !consumed.value?.uid) {
    const reason = consumed.reason
    return {
      ok: false,
      reason:
        reason === 'absent'
          ? 'unknown-request'
          : (reason as RedeemRefusal) ?? 'unknown-request',
    }
  }
  return {
    ok: true,
    uid: consumed.value.uid,
    tenantId: consumed.value.tenantId,
    continuePath: consumed.value.continuePath,
  }
}

/**
 * `consoleDomains/{host}.sessionEpoch`, or `0` when there is no usable one.
 *
 * `0` is returned for every unreadable shape — an unnormalizable host, an
 * absent document, a Firestore error, a non-finite or non-positive value — and
 * every caller reads `0` as "this control has nothing to say", i.e. FAILS OPEN.
 * That is deliberate and matches every other console-domain lookup: the Vercel
 * allowlist is the boundary and this is defence in depth, so a Firestore blip
 * must not lock every custom domain out of its own session.
 *
 * Note the split with {@link consoleSessionEpochRefuses}: failing open on a
 * missing EPOCH is not the same as failing open on a missing CREDENTIAL DATE.
 * A cookie whose `iat` cannot be read is refused, because an undateable
 * credential cannot be shown to postdate a revocation.
 */
export async function readConsoleSessionEpoch(host: string): Promise<number> {
  const domain = normalizeConsoleDomain(host)
  if (!domain) return 0
  let snapshot: FirebaseFirestore.DocumentSnapshot
  try {
    snapshot = await firestore()
      .collection(CONSOLE_DOMAINS_COLLECTION)
      .doc(domain)
      .get()
  } catch {
    return 0
  }
  if (!snapshot.exists) return 0
  const epoch = Number(snapshot.get('sessionEpoch') ?? 0)
  return Number.isFinite(epoch) && epoch > 0 ? epoch : 0
}

/**
 * The revocation epoch on a console domain (AGL-1353 D6).
 *
 * A session cookie minted before the epoch is dead. Bumping `sessionEpoch` —
 * which `suspendOnDowngrade` and `releaseConsoleDomain` already do — therefore
 * invalidates every outstanding cookie for that host instantly, at our
 * boundary. Our boundary is the ONLY place a Firebase session cookie has any
 * value: it is opaque and can only be cashed by `verifySessionCookie` under
 * our Admin credentials.
 *
 * Fails OPEN on a read error, matching every other console-domain lookup.
 */
export async function consoleSessionEpochRefuses(options: {
  host: string
  cookieIssuedAtMs: number | null
}): Promise<boolean> {
  const epoch = await readConsoleSessionEpoch(options.host)
  if (epoch <= 0) return false
  const issuedAt = Number(options.cookieIssuedAtMs ?? 0)
  // An undateable cookie cannot be shown to postdate the epoch, and the safe
  // direction for a revocation control is to refuse it.
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return true
  return issuedAt < epoch
}
