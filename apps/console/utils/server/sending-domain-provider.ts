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
 * Who issues a sending domain's DKIM key — the one seam the mail vendor lives
 * behind.
 *
 * The same shape as `AGLYN_DOMAIN_PROVIDER`, for the same reason: a self-host
 * operator may front a different mail provider, and "bring your own Firebase,
 * run it on Docker" cannot be true while the only way to get a signing key is
 * one vendor's API. One real driver and a `none` is the whole set — a third
 * driver should be written when a second provider actually exists, not
 * imagined now.
 *
 * ## WHY THIS FILE IS IN `apps/console` AND NOT IN A LIBRARY
 *
 * Creating a domain needs a credential that can create things.
 * `RESEND_API_KEY` cannot: it is send-only restricted, which is precisely why
 * `email-health.ts` is able to use `GET /domains` as a read-only probe
 * "because it cannot create anything". So this reads a SEPARATE, full-access
 * `RESEND_DOMAINS_API_KEY`.
 *
 * A key that can create domains can also list every domain in the account,
 * read the account's API keys and mint more of them. It must never be
 * reachable from the tenant runtime, which serves published sites to the
 * public internet and executes tenant-authored content.
 *
 * The isolation is STRUCTURAL, not a convention:
 *
 * 1. This module lives in `apps/console`. The tenant app has no path mapping
 *    to it — `tsconfig.base.json` maps `@aglyn/*` to `libs/*` and nothing to
 *    an app — and nx's `enforce-module-boundaries` forbids an app depending
 *    on another app, so `apps/tenant` cannot import it even by relative path
 *    across the workspace.
 * 2. The store seam it feeds (`recordIssuedSendingDomain`) lives in
 *    `@aglyn/tenant-data-admin`, which the tenant runtime DOES import — and
 *    that seam takes a key as an argument and reads no environment at all.
 *    Moving the driver into it would put the credential read one import away
 *    from tenant request handling.
 * 3. `sending-domain-credential-isolation.spec.ts` asserts both by sweeping
 *    the tree, so the boundary fails a test rather than a code review.
 *
 * ## The contract every driver owes
 *
 * 1. **Never throw.** The caller is an admin route that must still answer with
 *    the records and the DMARC read when the provider is down.
 * 2. **`skipped` is not a failure.** It is what an unconfigured deployment
 *    returns, and it leaves the domain at `requested` with `pendingProvider`
 *    set — the honest state for a deployment with no issuing credential.
 * 3. **Idempotent.** A domain the provider already holds is `already-exists`
 *    carrying that domain's real records, not an error and not a second
 *    domain.
 * 4. **`detail` is a CODE, never provider prose.** See {@link providerDetail}.
 * 5. **Never invent a record.** A response we cannot parse a DKIM record out
 *    of is `failed`. A synthesized key is a record the customer publishes,
 *    the verifier accepts, and no message ever signs with.
 */

import {
  normalizeSendingDomain,
  RESEND_DOMAINS_ENDPOINT,
  safeProviderDetail,
} from '@aglyn/shared-util-email'

/*==========================================
  The contract
==========================================*/

export type SendingDomainProviderId = 'resend' | 'none'

export type SendingDomainIssueOutcome =
  /** The provider created the domain and returned a signing key. */
  | 'issued'
  /** The provider already held this domain; its existing key is returned. */
  | 'already-exists'
  /** No issuing credential is configured. Not a failure. */
  | 'skipped'
  /** The provider refused, or answered something we will not guess at. */
  | 'failed'

export interface SendingDomainIssue {
  outcome: SendingDomainIssueOutcome
  domain: string
  /**
   * The public key as published, base64 and WITHOUT the `p=` prefix — read
   * off the provider's response, never derived. Null on every outcome but
   * `issued` and `already-exists`.
   */
  dkimPublicKey: string | null
  /**
   * The selector the provider will actually sign under, read off the name of
   * the DKIM record it returned.
   *
   * Resend signs on a selector of its own choosing rather than one we ask
   * for, so `sendingDkimSelector` PROPOSES a per-org name and this is what is
   * stored. Publishing our proposal against the provider's key would print a
   * record at a name nothing ever signs from — a verification that can never
   * pass, which is the failure `tenant-dns.ts` documents from the other side.
   */
  dkimSelector: string | null
  /** The provider's id for the domain object. Never a credential. */
  providerDomainId: string | null
  /** A short code from a fixed vocabulary. Safe to store, log and show. */
  detail: string | null
}

export interface SendingDomainProvider {
  /** Stable id, used in this module's log lines. Never a display name. */
  readonly id: SendingDomainProviderId
  /** Whether this deployment can actually issue a key. */
  configured(): boolean
  /** Create the domain at the provider and return the records it issued. */
  issue(domain: string): Promise<SendingDomainIssue>
}

function issueResult(
  outcome: SendingDomainIssueOutcome,
  domain: string,
  extra: Partial<SendingDomainIssue> = {},
): SendingDomainIssue {
  return {
    outcome,
    domain,
    dkimPublicKey: null,
    dkimSelector: null,
    providerDomainId: null,
    detail: null,
    ...extra,
  }
}

/**
 * Ceiling on a provider call.
 *
 * Longer than `DOMAIN_PROVIDER_TIMEOUT_MS` (5s) because this one is not
 * best-effort behind an org creation: it is the whole point of the click, and
 * a duplicate answer costs a second round trip to resolve. Still bounded,
 * because the route has to answer with the DMARC read and the records
 * whatever the provider does.
 */
export const SENDING_DOMAIN_PROVIDER_TIMEOUT_MS = 10_000

/** `AbortSignal.timeout`, without assuming the runtime has it. */
function deadline(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(SENDING_DOMAIN_PROVIDER_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

/*==========================================
  `detail` — a vocabulary, not a body
==========================================*/

/**
 * Error names we are willing to repeat back.
 *
 * An allowlist rather than a sanitizer, because the input is a response body
 * written by somebody else. The failure being prevented is concrete: the
 * request carries `Authorization: Bearer <full-access key>`, and a provider
 * (or a proxy in front of one) that echoes the request in its error message
 * would put that key into a Firestore document, a log drain and an admin
 * screen in one step. Nine literals cannot carry a secret.
 */
const KNOWN_PROVIDER_ERRORS = new Set([
  'application_error',
  'internal_server_error',
  'invalid_permission',
  'missing_api_key',
  'not_found',
  'rate_limit_exceeded',
  'restricted_api_key',
  'suspended_api_key',
  'validation_error',
])

/**
 * `http-422:validation_error` — the status, plus a name only if we already
 * know it. Nothing else from the response reaches a caller.
 */
function providerDetail(status: number, body: unknown): string {
  const name = (body as { name?: unknown })?.name
  const known =
    typeof name === 'string' && KNOWN_PROVIDER_ERRORS.has(name) ? name : ''
  return safeProviderDetail(`http-${status}${known ? `:${known}` : ''}`)
}

/** Whether a rejection was our own deadline rather than the network's. */
function abortedDetail(error: unknown): 'timeout' | 'network' {
  const name = (error as { name?: string })?.name
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
}

/*==========================================
  Reading a provider's DKIM record
==========================================*/

interface ProviderRecord {
  record?: unknown
  name?: unknown
  type?: unknown
  value?: unknown
}

/**
 * Pull the selector and the key out of the DKIM record a provider returned.
 *
 * Both come from the record; neither is derived. The name is returned either
 * relative (`resend._domainkey`) or absolute
 * (`resend._domainkey.acme.com`) depending on the provider, so the domain
 * suffix is trimmed and what remains must actually end in `._domainkey`. A
 * name we cannot read that way is a record we do not understand, and the
 * caller fails rather than guessing at a selector.
 */
export function readIssuedDkim(
  domain: string,
  records: unknown,
): { selector: string; publicKey: string } | null {
  const list = Array.isArray(records) ? (records as ProviderRecord[]) : []
  const entry = list.find(
    (item) =>
      String(item?.record ?? '').toUpperCase() === 'DKIM' ||
      /_domainkey/i.test(String(item?.name ?? '')),
  )
  if (!entry) return null

  const rawName = String(entry.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  const suffix = `.${normalizeSendingDomain(domain)}`
  const host = rawName.endsWith(suffix)
    ? rawName.slice(0, -suffix.length)
    : rawName
  const match = /^(.+)\._domainkey$/.exec(host)
  if (!match) return null

  const publicKey = String(entry.value ?? '')
    .trim()
    .replace(/^p\s*=\s*/i, '')
    .trim()
  if (!match[1] || !publicKey) return null

  return { selector: match[1], publicKey }
}

/*==========================================
  The Resend driver
==========================================*/

/**
 * Create a domain at Resend.
 *
 * `POST /domains` answers with the domain object and the records it wants
 * published — the DKIM record among them. That record is the only thing here
 * worth having: SPF and the return path are OUR configuration
 * (`AGLYN_EMAIL_SPF_INCLUDE`, `AGLYN_EMAIL_RETURN_PATH_HOST`) and are already
 * issued by `sendingDnsRecords`, which is also what the verifier compares
 * against. Taking those from the response instead would put a second source
 * of truth behind the one function that exists so there is only one.
 *
 * ## The duplicate
 *
 * Resend answers `422` when the account already holds the domain. That is
 * ordinarily OUR OWN earlier attempt — the `POST` succeeded and the process
 * died before the key was stored — so it is success, not failure, and
 * retrying must not create a second domain.
 *
 * But it is only adoptable once we have CONFIRMED it is the same name. The
 * list is fetched and matched on the normalized domain exactly, and the
 * fetched object's own `name` is checked again before its key is returned. A
 * `422` we cannot tie to the requested domain is `failed`: adopting the wrong
 * domain's key would hand a customer a record that signs for somebody else.
 *
 * ⚠️ Resend holds ONE domain object per name for the whole account, so two
 * orgs claiming the same name share a signing key and a selector — the
 * collision `sendingDkimSelector`'s per-org selector was written to prevent,
 * re-introduced by the provider rather than by us. Each org must still
 * publish that record in the zone to verify, so it is not a takeover of a
 * domain nobody controls; it does mean the second org inherits a verification
 * the first org's DNS satisfies. Closing it needs either a provider that
 * accepts a selector or an org-level claim on the name, and neither is in
 * this change.
 */
export const RESEND_SENDING_DOMAIN_PROVIDER: SendingDomainProvider = {
  id: 'resend',

  configured: () => Boolean(resendDomainsKey()),

  async issue(rawDomain: string): Promise<SendingDomainIssue> {
    const domain = normalizeSendingDomain(rawDomain)
    const apiKey = resendDomainsKey()
    if (!apiKey) return issueResult('skipped', domain, { detail: 'unconfigured' })
    if (!domain) return issueResult('failed', domain, { detail: 'invalid-domain' })

    try {
      const response = await fetch(RESEND_DOMAINS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
        signal: deadline(),
      })
      const payload = await response.json().catch(() => null)

      if (response.ok) {
        const dkim = readIssuedDkim(domain, (payload as { records?: unknown })?.records)
        if (!dkim) {
          console.error(
            '[sending-domain-provider:resend] no readable DKIM record',
            domain,
          )
          return issueResult('failed', domain, { detail: 'dkim-unreadable' })
        }
        return issueResult('issued', domain, {
          dkimPublicKey: dkim.publicKey,
          dkimSelector: dkim.selector,
          providerDomainId: providerId(payload),
        })
      }

      if (response.status === 422) return adoptExisting(domain, apiKey)

      const detail = providerDetail(response.status, payload)
      console.error('[sending-domain-provider:resend] issue failed', domain, detail)
      return issueResult('failed', domain, { detail })
    } catch (error) {
      const detail = abortedDetail(error)
      console.error('[sending-domain-provider:resend] issue threw', domain, detail)
      return issueResult('failed', domain, { detail })
    }
  },
}

/** The full-access credential. Read HERE and nowhere else in the workspace. */
function resendDomainsKey(): string {
  return String(process.env.RESEND_DOMAINS_API_KEY ?? '').trim()
}

function providerId(payload: unknown): string | null {
  const id = (payload as { id?: unknown })?.id
  return typeof id === 'string' && id ? id : null
}

/**
 * Resolve a `422` into the domain the account already holds, or fail.
 *
 * Two reads rather than one because the list endpoint does not carry records:
 * `GET /domains` to find the id for the name, then `GET /domains/{id}` for
 * the DKIM record. The name is checked at BOTH steps — the list match is on
 * the normalized name, and the fetched object is checked again — so a
 * provider that answers a different domain than the id asked for cannot hand
 * a customer somebody else's key.
 */
async function adoptExisting(
  domain: string,
  apiKey: string,
): Promise<SendingDomainIssue> {
  const headers = { Authorization: `Bearer ${apiKey}` }

  const listed = await fetch(RESEND_DOMAINS_ENDPOINT, {
    method: 'GET',
    headers,
    signal: deadline(),
  })
  if (!listed.ok) {
    const detail = providerDetail(listed.status, await listed.json().catch(() => null))
    console.error('[sending-domain-provider:resend] duplicate lookup failed', domain, detail)
    return issueResult('failed', domain, { detail })
  }

  const body = await listed.json().catch(() => null)
  const rows = Array.isArray((body as { data?: unknown })?.data)
    ? ((body as { data: unknown[] }).data as { id?: unknown; name?: unknown }[])
    : []
  const match = rows.find(
    (row) => normalizeSendingDomain(String(row?.name ?? '')) === domain,
  )
  const id = match && typeof match.id === 'string' ? match.id : ''
  if (!id) {
    // The provider says the name is taken and cannot show us by what. Nothing
    // here is adoptable, and inventing a key would be worse than refusing.
    console.error('[sending-domain-provider:resend] duplicate not in the list', domain)
    return issueResult('failed', domain, { detail: 'duplicate-not-found' })
  }

  const fetched = await fetch(`${RESEND_DOMAINS_ENDPOINT}/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers,
    signal: deadline(),
  })
  if (!fetched.ok) {
    const detail = providerDetail(fetched.status, await fetched.json().catch(() => null))
    console.error('[sending-domain-provider:resend] duplicate read failed', domain, detail)
    return issueResult('failed', domain, { detail })
  }

  const existing = await fetched.json().catch(() => null)
  if (normalizeSendingDomain(String((existing as { name?: unknown })?.name ?? '')) !== domain) {
    console.error('[sending-domain-provider:resend] duplicate names another domain', domain)
    return issueResult('failed', domain, { detail: 'duplicate-mismatch' })
  }

  const dkim = readIssuedDkim(domain, (existing as { records?: unknown })?.records)
  if (!dkim) {
    console.error('[sending-domain-provider:resend] duplicate has no readable DKIM', domain)
    return issueResult('failed', domain, { detail: 'dkim-unreadable' })
  }

  return issueResult('already-exists', domain, {
    dkimPublicKey: dkim.publicKey,
    dkimSelector: dkim.selector,
    providerDomainId: id,
  })
}

/*==========================================
  The driver that issues nothing
==========================================*/

/**
 * The default, and the state this deployment is actually in.
 *
 * Not an error. A deployment with no issuing credential leaves every domain
 * at `requested`, which has no records to publish and refuses sends — the
 * correct behavior for a domain with no signing key, and one the route
 * reports as `pendingProvider` rather than as an empty records table.
 */
export const NO_SENDING_DOMAIN_PROVIDER: SendingDomainProvider = {
  id: 'none',
  configured: () => false,
  issue: async (domain) =>
    issueResult('skipped', normalizeSendingDomain(domain), {
      detail: 'unconfigured',
    }),
}

/**
 * The configured provider id, or `null` to let {@link sendingDomainProvider}
 * infer it. An explicit value always wins, including `none`.
 */
function requestedProviderId(): SendingDomainProviderId | null {
  const raw = String(process.env.AGLYN_SENDING_DOMAIN_PROVIDER ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return null
  if (raw === 'resend' || raw === 'none') return raw
  console.error(
    `[sending-domain-provider] unknown AGLYN_SENDING_DOMAIN_PROVIDER "${raw}" ` +
      '— falling back to detection. Valid values: resend, none.',
  )
  return null
}

/**
 * The provider this deployment uses.
 *
 * Detection is the PRESENCE OF THE CREDENTIAL, which is safe in a way
 * `AGLYN_DOMAIN_PROVIDER`'s wildcard inference is not: a driver selected
 * because its key exists cannot claim to have done anything it did not do —
 * with no key there is no driver, and with a key the call either succeeds or
 * is reported failed.
 *
 * Not memoized. It is called once per admin click, and a cache keyed on the
 * environment would only exist to carry a reset hook production does not
 * need.
 */
export function sendingDomainProvider(): SendingDomainProvider {
  switch (requestedProviderId() ?? (resendDomainsKey() ? 'resend' : 'none')) {
    case 'resend':
      return RESEND_SENDING_DOMAIN_PROVIDER
    default:
      return NO_SENDING_DOMAIN_PROVIDER
  }
}
