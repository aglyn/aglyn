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

import type { RegistrarDnsRecord } from '../model/dns-records'
import type {
  RegistrantContact,
  RegistrarDriver,
  RegistrarListedRecord,
  RegistrarOrderStatus,
  RegistrarQuote,
  RegistrarResult,
  RegistrarTransferStatus,
} from './registrar'

/*
 * VERCEL'S REGISTRAR API as a {@link RegistrarDriver} (AGL-3962).
 *
 * `/v1/registrar/*` sells, renews and transfers in; `/v5/domains/{name}` says
 * whether the name is ours, when it expires and whose nameservers it uses;
 * `/v5`, `/v2` and `/v1` `…/records` read and write its DNS (AGL-4040). Same `VERCEL_TOKEN` and `VERCEL_TEAM_ID`
 * the domain provider attaches names with, so a domain bought here lands in
 * the team whose project serves it and its DNS is Vercel's from the first
 * second — which is what lets the site go live with no DNS step at all.
 */

const API = 'https://api.vercel.com'

/** Each call is bounded; a purchase waits on this, a sweep walks many. */
export const VERCEL_REGISTRAR_TIMEOUT_MS = 10_000

interface Settings {
  token: string
  teamId?: string
}

function settings(): Settings | null {
  const token = String(process.env['VERCEL_TOKEN'] ?? '').trim()
  if (!token) return null
  const teamId = String(process.env['VERCEL_TEAM_ID'] ?? '').trim()
  return { token, teamId: teamId || undefined }
}

type Answer = { status: number; body: Record<string, unknown> | null }

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  query: Record<string, string> = {},
): Promise<Answer | { status: 0; body: null; network: 'timeout' | 'network' }> {
  const config = settings()
  if (!config) return { status: 0, body: null, network: 'network' }
  const params = new URLSearchParams(query)
  if (config.teamId) params.set('teamId', config.teamId)
  const search = params.toString()
  try {
    const response = await fetch(`${API}${path}${search ? `?${search}` : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(VERCEL_REGISTRAR_TIMEOUT_MS),
    })
    const parsed = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    return { status: response.status, body: parsed }
  } catch (error) {
    const name = (error as { name?: string })?.name
    return {
      status: 0,
      body: null,
      network: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
    }
  }
}

/**
 * A refusal as a code. Vercel's `code` field is already a stable token
 * (`expected_price_mismatch`, `domain_not_available`…), so it is kept as is;
 * anything else is named by its status.
 */
function refusal<T>(
  answer: Awaited<ReturnType<typeof call>>,
): Extract<RegistrarResult<T>, { ok: 'no' }> {
  if (answer.status === 0) {
    return { ok: 'no', code: 'network' in answer ? answer.network : 'network', retryable: true }
  }
  const raw =
    (answer.body?.['error'] as { code?: unknown } | undefined)?.code ??
    answer.body?.['code']
  const code =
    typeof raw === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(raw)
      ? raw
      : `http_${answer.status}`
  const retryable = answer.status === 429 || answer.status >= 500
  return { ok: 'no', code, retryable }
}

const ok = (status: number) => status >= 200 && status < 300

/** The registrant contact as Vercel's `contactInformation` takes it. */
export function contactInformation(contact: RegistrantContact): Record<string, string> {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    address1: contact.address1,
    ...(contact.address2 ? { address2: contact.address2 } : {}),
    city: contact.city,
    state: contact.state,
    zip: contact.zip,
    country: contact.country,
    ...(contact.companyName ? { companyName: contact.companyName } : {}),
  }
}

/**
 * The date in a `domain_cannot_be_transfered_out_until` refusal. Vercel puts
 * it in the message alone, so it is read from there: an ISO date or
 * timestamp first, then whatever follows "until". Null when none parses,
 * and the page then says the registry's lock without a date.
 */
export function transferLockUntil(message: unknown): number | null {
  const text = String(message ?? '')
  const iso = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/.exec(text)
  if (iso) {
    const parsed = Date.parse(iso[0].includes('T') || iso[0].includes(' ') ? iso[0] : `${iso[0]}T00:00:00Z`)
    if (Number.isFinite(parsed)) return parsed
  }
  const after = /until\s+(.+?)\.?$/i.exec(text)
  if (after) {
    const parsed = Date.parse(after[1])
    if (Number.isFinite(parsed)) return parsed
  }
  const epoch = /\b(1\d{12})\b/.exec(text)
  return epoch ? Number(epoch[1]) : null
}

/** The registrar's transfer states, as the lifecycle reads them. */
export function transferStatusOf(state: string): RegistrarTransferStatus['status'] {
  if (state === 'completed') return 'completed'
  if (['failed', 'rejected', 'canceled', 'canceled_pending_refund'].includes(state)) return 'failed'
  return 'pending'
}

const host = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\.$/, '')

/** A record body as Vercel's create and update take it. */
function recordBody(record: RegistrarDnsRecord): Record<string, unknown> {
  return {
    type: record.type,
    name: record.name,
    ...(record.value !== undefined ? { value: record.value } : {}),
    ...(record.ttl !== undefined ? { ttl: record.ttl } : {}),
    ...(record.mxPriority !== undefined ? { mxPriority: record.mxPriority } : {}),
    ...(record.srv ? { srv: record.srv } : {}),
  }
}

const num = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

const msOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const VERCEL_REGISTRAR: RegistrarDriver = {
  id: 'vercel',

  configured: () => settings() !== null,

  async search(domains) {
    if (domains.length === 0) return { ok: 'yes', value: [] }
    const answer = await call('POST', '/v1/registrar/domains/search', {
      domains: domains.slice(0, 200),
    })
    if (!ok(answer.status)) return refusal(answer)
    const results = Array.isArray(answer.body?.['results'])
      ? (answer.body?.['results'] as Record<string, unknown>[])
      : []
    const quotes: RegistrarQuote[] = results.map((row) => ({
      domain: String(row['domain'] ?? '').toLowerCase(),
      available: row['available'] === true,
      premium: row['premium'] === true,
      years: num(row['years']) || 1,
      purchaseUsd: num(row['price']),
      renewalUsd: num(row['renewalPrice']),
    }))
    return { ok: 'yes', value: quotes }
  },

  async standardContact(domain) {
    const answer = await call(
      'GET',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/contact-info/schema`,
    )
    if (!ok(answer.status)) return refusal(answer)
    // An empty schema is the standard contact alone; anything in it is an
    // ending's extra demand — a nexus, a local presence, a licence number.
    const extra = answer.body ? Object.keys(answer.body) : []
    return { ok: 'yes', value: extra.length === 0 }
  },

  async buy({ domain, years, expectedPriceUsd, autoRenew, contact }) {
    const answer = await call(
      'POST',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/buy`,
      {
        autoRenew,
        years,
        expectedPrice: expectedPriceUsd,
        contactInformation: contactInformation(contact),
      },
    )
    if (!ok(answer.status)) return refusal(answer)
    const orderId = String(answer.body?.['orderId'] ?? '')
    if (!orderId) return { ok: 'no', code: 'no-order-id', retryable: false }
    return { ok: 'yes', value: { orderId } }
  },

  async order(orderId) {
    const answer = await call(
      'GET',
      `/v1/registrar/orders/${encodeURIComponent(orderId)}`,
    )
    if (!ok(answer.status)) return refusal(answer)
    const lines = Array.isArray(answer.body?.['domains'])
      ? (answer.body?.['domains'] as Record<string, unknown>[])
      : []
    const line = lines[0]
    // The order's own status says the order finished; the LINE says whether
    // the name was registered. A completed order with a refunded line is a
    // name we do not hold.
    const lineStatus = String(line?.['status'] ?? '')
    const failedLine =
      lineStatus === 'failed' ||
      lineStatus === 'refunded' ||
      lineStatus === 'refund-failed'
    const status: RegistrarOrderStatus =
      failedLine || answer.body?.['status'] === 'failed'
        ? 'failed'
        : lineStatus === 'completed'
          ? 'completed'
          : 'pending'
    const errorCode = (line?.['error'] as { code?: unknown } | undefined)?.code
    return {
      ok: 'yes',
      value: {
        orderId,
        status,
        ...(status === 'failed'
          ? {
              failure:
                typeof errorCode === 'string' ? errorCode : lineStatus || 'order-failed',
            }
          : {}),
      },
    }
  },

  async renew({ domain, years, expectedPriceUsd, contact }) {
    const answer = await call(
      'POST',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/renew`,
      {
        years,
        expectedPrice: expectedPriceUsd,
        ...(contact ? { contactInformation: contactInformation(contact) } : {}),
      },
    )
    if (!ok(answer.status)) return refusal(answer)
    const orderId = String(answer.body?.['orderId'] ?? '')
    if (!orderId) return { ok: 'no', code: 'no-order-id', retryable: false }
    return { ok: 'yes', value: { orderId } }
  },

  async renewalPrice(domain) {
    const answer = await call(
      'GET',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/price`,
      undefined,
      { years: '1' },
    )
    if (!ok(answer.status)) return refusal(answer)
    const price = num(answer.body?.['renewalPrice'])
    if (price <= 0) return { ok: 'no', code: 'no-renewal-price', retryable: true }
    return { ok: 'yes', value: price }
  },

  async setAutoRenew(domain, autoRenew) {
    const answer = await call(
      'PATCH',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/auto-renew`,
      { autoRenew },
    )
    if (!ok(answer.status)) return refusal(answer)
    return { ok: 'yes', value: true }
  },

  async info(domain) {
    const answer = await call('GET', `/v5/domains/${encodeURIComponent(domain)}`)
    if (answer.status === 404) {
      return {
        ok: 'yes',
        value: { owned: false, registeredAtMs: null, expiresAtMs: null, autoRenew: null },
      }
    }
    if (!ok(answer.status)) return refusal(answer)
    const row = (answer.body?.['domain'] ?? {}) as Record<string, unknown>
    // `boughtAt` is set only on a name this team REGISTERED here, and
    // `transferredAt` on one it moved here (AGL-4040); a name merely added to
    // the team for its DNS has neither, and is not ours to renew.
    const boughtAt = msOrNull(row['boughtAt']) ?? msOrNull(row['transferredAt'])
    return {
      ok: 'yes',
      value: {
        owned: boughtAt !== null,
        registeredAtMs: boughtAt,
        expiresAtMs: msOrNull(row['expiresAt']),
        autoRenew: typeof row['renew'] === 'boolean' ? (row['renew'] as boolean) : null,
      },
    }
  },

  async contactVerification(domain) {
    const answer = await call(
      'GET',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/contact-verification`,
    )
    if (!ok(answer.status)) return refusal(answer)
    const verified = answer.body?.['verified'] === true
    return {
      ok: 'yes',
      value: {
        verified,
        verifyByMs: verified ? null : msOrNull(answer.body?.['verifyBy']),
        email: verified ? null : String(answer.body?.['email'] ?? '') || null,
      },
    }
  },

  async authCode(domain) {
    const answer = await call(
      'GET',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/auth-code`,
    )
    if (!ok(answer.status)) {
      const refused = refusal<string>(answer)
      if (refused.code === 'domain_cannot_be_transfered_out_until') {
        return { ...refused, untilMs: transferLockUntil(answer.body?.['message']) }
      }
      return refused
    }
    const code = String(answer.body?.['authCode'] ?? '')
    if (!code) return { ok: 'no', code: 'no-auth-code', retryable: true }
    return { ok: 'yes', value: code }
  },

  async listOwned() {
    const owned: { domain: string; boughtAtMs: number | null; autoRenew: boolean | null }[] = []
    let until: string | undefined
    // A bounded walk: a team with more names than this is a team whose
    // reconcile wants a real index, and a runaway loop is worse than a
    // partial answer the next sweep continues.
    for (let page = 0; page < 20; page += 1) {
      const answer = await call(
        'GET',
        '/v5/domains',
        undefined,
        until ? { limit: '100', until } : { limit: '100' },
      )
      if (!ok(answer.status)) return refusal(answer)
      const rows = Array.isArray(answer.body?.['domains'])
        ? (answer.body?.['domains'] as Record<string, unknown>[])
        : []
      for (const row of rows) {
        const boughtAtMs = msOrNull(row['boughtAt']) ?? msOrNull(row['transferredAt'])
        if (boughtAtMs === null) continue
        owned.push({
          domain: String(row['name'] ?? '').toLowerCase(),
          boughtAtMs,
          autoRenew: typeof row['renew'] === 'boolean' ? (row['renew'] as boolean) : null,
        })
      }
      const next = (answer.body?.['pagination'] as { next?: unknown } | undefined)?.next
      if (typeof next !== 'number' && typeof next !== 'string') break
      until = String(next)
    }
    return { ok: 'yes', value: owned }
  },
  async transferPrice(domain) {
    const answer = await call(
      'GET',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/price`,
      undefined,
      { years: '1' },
    )
    if (!ok(answer.status)) return refusal(answer)
    const price = num(answer.body?.['transferPrice'])
    if (price <= 0) return { ok: 'no', code: 'no-transfer-price', retryable: false }
    return { ok: 'yes', value: price }
  },

  async transferIn({ domain, authCode, years, expectedPriceUsd, autoRenew, contact }) {
    const answer = await call(
      'POST',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/transfer`,
      {
        authCode,
        autoRenew,
        years,
        expectedPrice: expectedPriceUsd,
        contactInformation: contactInformation(contact),
      },
    )
    if (!ok(answer.status)) return refusal(answer)
    const orderId = String(answer.body?.['orderId'] ?? '')
    if (!orderId) return { ok: 'no', code: 'no-order-id', retryable: false }
    return { ok: 'yes', value: { orderId } }
  },

  async transferStatus(domain) {
    const answer = await call(
      'GET',
      `/v1/registrar/domains/${encodeURIComponent(domain)}/transfer`,
    )
    if (!ok(answer.status)) return refusal(answer)
    const state = String(answer.body?.['status'] ?? '')
    if (!state) return { ok: 'no', code: 'no-transfer-status', retryable: true }
    return { ok: 'yes', value: { status: transferStatusOf(state), state } }
  },

  async nameservers(domain) {
    const answer = await call('GET', `/v5/domains/${encodeURIComponent(domain)}`)
    if (!ok(answer.status)) return refusal(answer)
    const row = (answer.body?.['domain'] ?? {}) as Record<string, unknown>
    const list = (value: unknown) => (Array.isArray(value) ? value.map(host).filter(Boolean) : [])
    const nameservers = list(row['nameservers'])
    const intended = list(row['intendedNameservers'])
    const custom = list(row['customNameservers'])
    const ours =
      custom.length === 0 &&
      (row['serviceType'] === 'zeit.world' ||
        (nameservers.length > 0 &&
          intended.length > 0 &&
          nameservers.every((name) => intended.includes(name))))
    return { ok: 'yes', value: { ours, nameservers, intended } }
  },

  async listDnsRecords(domain) {
    const records: RegistrarListedRecord[] = []
    let until: string | undefined
    // Bounded, as `listOwned` is: a zone with more records than this is not
    // one a form-at-a-time editor serves.
    for (let page = 0; page < 5; page += 1) {
      const answer = await call(
        'GET',
        `/v5/domains/${encodeURIComponent(domain)}/records`,
        undefined,
        until ? { limit: '100', until } : { limit: '100' },
      )
      if (!ok(answer.status)) return refusal(answer)
      const rows = Array.isArray(answer.body?.['records'])
        ? (answer.body?.['records'] as Record<string, unknown>[])
        : []
      for (const row of rows) {
        const priority = row['mxPriority'] ?? row['priority']
        records.push({
          id: String(row['id'] ?? ''),
          type: String(row['type'] ?? ''),
          name: String(row['name'] ?? '').toLowerCase(),
          value: String(row['value'] ?? ''),
          ttl: typeof row['ttl'] === 'number' ? (row['ttl'] as number) : null,
          priority: typeof priority === 'number' ? priority : null,
          creator: typeof row['creator'] === 'string' ? (row['creator'] as string) : null,
        })
      }
      const next = (answer.body?.['pagination'] as { next?: unknown } | undefined)?.next
      if (typeof next !== 'number' && typeof next !== 'string') break
      until = String(next)
    }
    return { ok: 'yes', value: records.filter((record) => record.id) }
  },

  async createDnsRecord(domain, record) {
    const answer = await call(
      'POST',
      `/v2/domains/${encodeURIComponent(domain)}/records`,
      recordBody(record),
    )
    if (!ok(answer.status)) return refusal(answer)
    const id = String(answer.body?.['uid'] ?? '')
    if (!id) return { ok: 'no', code: 'no-record-id', retryable: false }
    return { ok: 'yes', value: { id } }
  },

  async updateDnsRecord(recordId, record) {
    const answer = await call(
      'PATCH',
      `/v1/domains/records/${encodeURIComponent(recordId)}`,
      recordBody(record),
    )
    if (!ok(answer.status)) return refusal(answer)
    return { ok: 'yes', value: true }
  },

  async deleteDnsRecord(domain, recordId) {
    const answer = await call(
      'DELETE',
      `/v2/domains/${encodeURIComponent(domain)}/records/${encodeURIComponent(recordId)}`,
    )
    if (!ok(answer.status)) return refusal(answer)
    return { ok: 'yes', value: true }
  },
}
