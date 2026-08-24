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
 * The App Check reCAPTCHA allowlist, written from the product (AGL-1378).
 *
 * ## Why this file has to exist
 *
 * The console reads Firestore **client-side**, and App Check gates those reads
 * with a reCAPTCHA token that the key itself refuses to mint on an origin it
 * has never heard of. Measured against the live key on 2026-08-23, with both
 * controls, by requesting `recaptcha/api2/anchor` with a base64 `co` origin:
 *
 * ```
 * https://app.aglyn.com:443                    ACCEPTED   (listed)
 * https://never-registered-9f3x.aglyn.com:443  ACCEPTED   (subtree of a listed entry)
 * https://console.acme-agency.example:443      REJECTED   "Invalid domain for site key"
 * https://console.northwind-coffee.com:443     REJECTED   "Invalid domain for site key"
 * ```
 *
 * A rejected solve means `initializeAppCheck` → `getToken` fails with
 * `appCheck/recaptcha-error`, and the very next Identity Platform call is
 * refused `401 UNAUTHENTICATED — "Firebase App Check token is invalid"`
 * **before** token validation (`docs/design/agl-1099a-poc-findings.md` §2).
 * So a custom console domain that is attached and routed but not allowlisted
 * renders a console that can never sign anyone in — and the symptom the
 * customer reports is "Missing or insufficient permissions", which is the same
 * string a Security Rules verdict produces. That is the misdiagnosis this
 * whole area keeps generating; the fix is to never let the state exist.
 *
 * ## Why it was believed impossible, and why that is stale
 *
 * AGL-1378 concluded the key was a classic v3 key with no management API. The
 * key was auto-migrated into a Google-created project, and every probe asked
 * `aglyn-main` — where the reCAPTCHA API genuinely is disabled — rather than
 * the project the key actually lives in. Measured 2026-08-23:
 * `recaptchaenterprise.googleapis.com` is enabled there, two accounts we
 * control are `roles/owner`, and `projects.keys.patch` on
 * `webSettings.allowedDomains` answers `200`.
 *
 * ## The two hazards this code is shaped around
 *
 * 1. **A patch that drops sibling fields.** `webSettings` also carries
 *    `allowAllDomains`, `integrationType`, `allowAmpTraffic` and
 *    `challengeSecurityPreference`; a whole-object write that omitted
 *    `allowAllDomains` would read as `false`… or a future default. So the mask
 *    is `webSettings.allowedDomains` — the narrowest path the API accepts —
 *    **and** the response is re-read afterwards: every domain that was there
 *    before must still be there, and `allowAllDomains` must still be `false`.
 *    A write that silently widened the key to every origin is a worse outcome
 *    than the domain never being listed.
 * 2. **Silent success.** Every outcome here is explicit, and
 *    {@link allowlistSatisfied} is the ONLY place that decides which ones mean
 *    "the customer can actually sign in". `activateConsoleDomain` refuses to
 *    mark a claim `active` unless it says yes.
 *
 * ## Exact names, never subtree cover
 *
 * A listed entry covers its whole subtree but never its parents (proved
 * 2026-08-10). It is therefore tempting to skip the write when some existing
 * entry already covers the new name. Deliberately not done: if org A holds
 * `acme.com` and org B later claims `console.acme.com`, B would be silently
 * covered by A's entry — and A detaching would break B with no trace linking
 * the two. One entry per claimed apex is what the documented 250-domain
 * ceiling is denominated in anyway (250 distinct customer apexes, occupancy 5
 * on 2026-08-23), so exactness costs nothing we were not already counting.
 */

import { getApp } from 'firebase-admin/app'

const RECAPTCHA_API = 'https://recaptchaenterprise.googleapis.com/v1'

/**
 * Published ceiling for `webSettings.allowedDomains`, quoted rather than
 * measured: *"Each key supports a maximum of 250 domains."* An occupancy
 * reading is NOT a limit — this repo already spent two weeks treating a
 * snapshot of nine entries as a hard ceiling. Re-probe occupancy, never the
 * limit.
 */
export const MAX_ALLOWED_DOMAINS = 250

/**
 * Ceiling on the whole exchange, matching `workspace-domains.ts`.
 *
 * This one is awaited by an attach the operator is watching, so an
 * unresponsive Google API must lose quickly rather than hang the activation
 * until the platform kills the function.
 */
const REQUEST_TIMEOUT_MS = 8_000

export type RecaptchaAllowlistOutcome =
  /** We wrote the entry and re-read the key to confirm it. */
  | 'listed'
  /** The exact name was already on the key; nothing was written. */
  | 'already-listed'
  /** We removed the entry and re-read the key to confirm it. */
  | 'removed'
  /** Nothing to remove — the exact name was not on the key. */
  | 'absent'
  /**
   * This deployment runs no App Check reCAPTCHA provider, so there is no
   * allowlist to maintain and nothing is gated. Self-host, and local dev.
   */
  | 'unenforced'
  /** The key is at {@link MAX_ALLOWED_DOMAINS}. A commercial event, not a bug. */
  | 'full'
  /** Anything else: misconfiguration, IAM, transport, or a suspicious write. */
  | 'failed'

export interface RecaptchaAllowlistResult {
  outcome: RecaptchaAllowlistOutcome
  domain: string
  /** Human-readable cause. Always set when the outcome is not a success. */
  detail?: string
  /**
   * Live `allowedDomains` after the operation, when we got far enough to read
   * them. Occupancy is worth surfacing precisely because it must never be
   * quoted from memory.
   */
  allowedDomains?: string[]
}

/**
 * Does this outcome mean the origin can attest?
 *
 * The single decision point, so that no caller can invent a looser one. Note
 * what is NOT here: `full` and `failed` both leave a domain that will 401 its
 * customer at sign-in, and `full` is the easier of the two to mistake for a
 * warning.
 */
export function allowlistSatisfied(outcome: RecaptchaAllowlistOutcome): boolean {
  return (
    outcome === 'listed' ||
    outcome === 'already-listed' ||
    outcome === 'removed' ||
    outcome === 'absent' ||
    outcome === 'unenforced'
  )
}

type Config =
  | { kind: 'unenforced' }
  | { kind: 'misconfigured'; detail: string }
  | { kind: 'ready'; keyName: string }

/**
 * `unenforced` is the ONLY safe way to skip, and it is gated on the client's
 * own site key rather than on this file's credentials.
 *
 * The failure this shape exists to prevent: a production deployment that runs
 * App Check but has no `RECAPTCHA_ADMIN_KEY_NAME` would, under a
 * "missing config → skip" rule, report every custom domain ready while listing
 * none of them. Configuration absence must therefore mean two different things
 * depending on whether App Check is running at all — and the tell is
 * `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY`, which is exactly what
 * `new ReCaptchaV3Provider(...)` is handed.
 *
 * The admin key name must also END with that site key. A resource name
 * pointing at a different key would be written happily and attest nothing —
 * the one misconfiguration whose symptom is indistinguishable from success.
 */
function config(): Config {
  const siteKey = String(process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY ?? '').trim()
  const keyName = String(process.env.RECAPTCHA_ADMIN_KEY_NAME ?? '').trim()
  if (!siteKey) return { kind: 'unenforced' }
  if (!keyName) {
    return {
      kind: 'misconfigured',
      detail:
        'App Check runs here (NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY is set) but RECAPTCHA_ADMIN_KEY_NAME is not, so the allowlist cannot be written',
    }
  }
  if (!/^projects\/[^/]+\/keys\/[^/]+$/.test(keyName)) {
    return {
      kind: 'misconfigured',
      detail: `RECAPTCHA_ADMIN_KEY_NAME must be projects/{project}/keys/{siteKey}, got "${keyName}"`,
    }
  }
  if (!keyName.endsWith(`/${siteKey}`)) {
    return {
      kind: 'misconfigured',
      detail:
        'RECAPTCHA_ADMIN_KEY_NAME names a different key than NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY — writing it would allowlist a key nothing uses',
    }
  }
  return { kind: 'ready', keyName }
}

/**
 * An OAuth token for the same service account firebase-admin already runs as.
 *
 * Not a second credential: `cert()`'s `getAccessToken()` requests
 * `https://www.googleapis.com/auth/cloud-platform` among its scopes, which is
 * the scope `recaptchaenterprise.googleapis.com` asks for. The account needs
 * `recaptchaenterprise.keys.get` + `.update` on the project the KEY lives in —
 * which is not `aglyn-main`; the key was migrated into its own project and
 * that is the whole reason this was thought unautomatable.
 */
async function accessToken(): Promise<string> {
  const credential = getApp().options.credential
  if (!credential) throw new Error('firebase-admin app has no credential')
  const token = await credential.getAccessToken()
  const value = token?.access_token
  if (!value) throw new Error('credential returned no access token')
  return value
}

async function call(
  url: string,
  init: RequestInit & { token: string },
): Promise<{ ok: boolean; status: number; body: any }> {
  const { token, ...rest } = init
  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(rest.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

function domainsOf(key: any): string[] {
  const domains = key?.webSettings?.allowedDomains
  return Array.isArray(domains) ? domains.map((entry: unknown) => String(entry)) : []
}

function normalize(input: string): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

/**
 * Read the key, apply `mutate` to its domains, write back, and prove the write.
 *
 * `mutate` returning `null` means "no write is needed" and is a success.
 */
async function rewrite(
  domain: string,
  mutate: (
    current: string[],
  ) =>
    | { next: string[]; outcome: RecaptchaAllowlistOutcome }
    | { skip: RecaptchaAllowlistOutcome; detail?: string },
): Promise<RecaptchaAllowlistResult> {
  const settings = config()
  if (settings.kind === 'unenforced') return { outcome: 'unenforced', domain }
  if (settings.kind === 'misconfigured') {
    return { outcome: 'failed', domain, detail: settings.detail }
  }

  let token: string
  try {
    token = await accessToken()
  } catch (error) {
    return { outcome: 'failed', domain, detail: `credential: ${String(error)}` }
  }

  const url = `${RECAPTCHA_API}/${settings.keyName}`
  let before: any
  try {
    const read = await call(url, { method: 'GET', token })
    if (!read.ok) {
      return {
        outcome: 'failed',
        domain,
        detail: `read ${read.status}: ${read.body?.error?.message ?? 'unknown'}`,
      }
    }
    before = read.body
  } catch (error) {
    return { outcome: 'failed', domain, detail: `read: ${String(error)}` }
  }

  const current = domainsOf(before)
  const plan = mutate(current)
  if ('skip' in plan) {
    return {
      outcome: plan.skip,
      domain,
      detail: plan.detail,
      allowedDomains: current,
    }
  }

  let after: any
  try {
    const written = await call(`${url}?updateMask=webSettings.allowedDomains`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ webSettings: { allowedDomains: plan.next } }),
    })
    if (!written.ok) {
      return {
        outcome: 'failed',
        domain,
        detail: `write ${written.status}: ${written.body?.error?.message ?? 'unknown'}`,
        allowedDomains: current,
      }
    }
    after = written.body
  } catch (error) {
    return { outcome: 'failed', domain, detail: `write: ${String(error)}`, allowedDomains: current }
  }

  // Hazard 1. The response is the authoritative post-state, so believe it
  // rather than the request body. A mask that the API interpreted more
  // broadly than intended shows up here as a missing sibling field or a
  // vanished entry — and `allowAllDomains: true` would be a key open to every
  // origin on the internet, which must never be a side effect of adding one.
  const applied = domainsOf(after)
  const lost = plan.next.filter((entry) => !applied.includes(entry))
  if (lost.length > 0) {
    return {
      outcome: 'failed',
      domain,
      detail: `the key did not keep every domain the write sent (missing: ${lost.join(', ')})`,
      allowedDomains: applied,
    }
  }
  if (after?.webSettings?.allowAllDomains === true) {
    return {
      outcome: 'failed',
      domain,
      detail: 'the write left allowAllDomains true — the key would accept every origin',
      allowedDomains: applied,
    }
  }

  return { outcome: plan.outcome, domain, allowedDomains: applied }
}

/**
 * Put a custom console domain on the key, so a browser there can attest.
 *
 * Called by `activateConsoleDomain` for the **serving** name only. Redirect
 * twins (`www.acme.com` → `acme.com`) never execute the console, never load
 * reCAPTCHA, and would spend a slot of the 250 for nothing.
 */
export async function allowConsoleOrigin(
  input: string,
): Promise<RecaptchaAllowlistResult> {
  const domain = normalize(input)
  if (!domain) return { outcome: 'failed', domain: '', detail: 'No domain given' }
  return rewrite(domain, (current) => {
    if (current.includes(domain)) return { skip: 'already-listed' as const }
    if (current.length >= MAX_ALLOWED_DOMAINS) {
      return {
        skip: 'full' as const,
        detail: `the key holds ${current.length} of ${MAX_ALLOWED_DOMAINS} domains`,
      }
    }
    return { next: [...current, domain], outcome: 'listed' as const }
  })
}

/**
 * Take a domain back off the key when its claim is released.
 *
 * Removes the EXACT entry and nothing else. A filter that matched subdomains
 * would take `aglyn.com` off the key while releasing `console.aglyn.com` —
 * and the entry it deleted is the one every Aglyn origin attests against.
 */
export async function reclaimConsoleOrigin(
  input: string,
): Promise<RecaptchaAllowlistResult> {
  const domain = normalize(input)
  if (!domain) return { outcome: 'failed', domain: '', detail: 'No domain given' }
  return rewrite(domain, (current) => {
    if (!current.includes(domain)) return { skip: 'absent' as const }
    const next = current.filter((entry) => entry !== domain)
    if (next.length !== current.length - 1) {
      return {
        skip: 'failed' as const,
        detail: `removing ${domain} would have removed ${current.length - next.length} entries`,
      }
    }
    return { next, outcome: 'removed' as const }
  })
}

/**
 * Read-only occupancy, for an operator asking "how many of the 250 are gone?"
 *
 * Deliberately returns the live list rather than a count: a count is what got
 * quoted as a ceiling for two weeks.
 */
export async function readConsoleOriginAllowlist(): Promise<{
  domains: string[] | null
  limit: number
  detail?: string
}> {
  const result = await rewrite('', () => ({ skip: 'absent' as const }))
  if (result.outcome === 'unenforced') {
    return { domains: null, limit: MAX_ALLOWED_DOMAINS, detail: 'App Check is not configured here' }
  }
  if (result.outcome === 'failed') {
    return { domains: null, limit: MAX_ALLOWED_DOMAINS, detail: result.detail }
  }
  return { domains: result.allowedDomains ?? [], limit: MAX_ALLOWED_DOMAINS }
}
