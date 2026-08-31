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
 * WRITING OUR OWN DNS ZONE — the second seam the vendor lives behind.
 *
 * This is what makes a per-site sending domain automatic. A customer's own
 * domain means records we print and they publish, and a wizard that waits.
 * A domain inside the apex we own means records we write ourselves, and a site
 * that is ready to send without its owner ever seeing a DNS instruction.
 *
 * The whole difference is who controls the zone, which is why
 * `isPlatformSendingDomain` guards every call into here: a bug that pointed
 * this at a customer's name would be an attempt to write records in a zone we
 * have no business in, and it must be impossible rather than merely unlikely.
 *
 * ## The contract, matching `sending-domain-provider.ts`
 *
 * 1. **Never throw.** The caller is a sweep across many sites and must not
 *    stop at the first bad one.
 * 2. **`skipped` is not a failure.** An unconfigured deployment — a self-host
 *    running on somebody else's DNS — returns it, and the domain stays where
 *    it was rather than being marked broken.
 * 3. **Idempotent.** A record that already carries the right value is success,
 *    not a duplicate. This is the property a retry depends on.
 * 4. **`detail` is a CODE, never provider prose.**
 */

import {
  isPlatformSendingDomain,
  safeProviderDetail,
  tenantWebApex,
  type PlatformZoneRecord,
} from '@aglyn/shared-util-email'

/*==========================================
  The contract
==========================================*/

export type ZoneWriteOutcome =
  /** Every record is present with the value we asked for. */
  | 'written'
  /** No zone credential is configured. Not a failure. */
  | 'skipped'
  /** The provider refused, or answered something we will not guess at. */
  | 'failed'

export interface ZoneWriteResult {
  outcome: ZoneWriteOutcome
  /** How many records this call created. Zero on a fully idempotent retry. */
  created: number
  /** A short code from a fixed vocabulary. Null when nothing went wrong. */
  detail: string | null
}

export interface SendingZoneProvider {
  readonly id: 'vercel' | 'none'
  configured(): boolean
  /** Create every record, skipping any that already carries its value. */
  write(records: readonly PlatformZoneRecord[]): Promise<ZoneWriteResult>
  /** Remove every record matching these names. Never throws. */
  remove(names: readonly string[]): Promise<ZoneWriteResult>
}

/**
 * Ceiling on a zone call. The same 10s as the mail provider's, and for the
 * same reason: this is the point of the operation rather than a best-effort
 * side errand, but a sweep still has to answer.
 */
export const SENDING_ZONE_TIMEOUT_MS = 10_000

function deadline(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(SENDING_ZONE_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

/**
 * Error codes we are willing to repeat back.
 *
 * An allowlist rather than a sanitizer, for the reason the mail driver's is:
 * the request carries `Authorization: Bearer <token>`, and a provider or proxy
 * that echoes the request into an error message would put that token into a
 * Firestore document and a log drain in one step.
 */
const KNOWN_ZONE_ERRORS = new Set([
  'bad_request',
  'forbidden',
  'invalid_record',
  'not_found',
  'rate_limited',
  'record_already_exists',
  'unauthorized',
])

function zoneDetail(status: number, body: unknown): string {
  const code = (body as { error?: { code?: unknown } })?.error?.code
  const known =
    typeof code === 'string' && KNOWN_ZONE_ERRORS.has(code) ? code : ''
  return safeProviderDetail(`http-${status}${known ? `:${known}` : ''}`)
}

function abortedDetail(error: unknown): 'timeout' | 'network' {
  const name = (error as { name?: string })?.name
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
}

/*==========================================
  The Vercel driver
==========================================*/

interface ZoneSettings {
  token: string
  zone: string
  teamId?: string
}

/**
 * The zone credential and the zone it may write.
 *
 * `VERCEL_TOKEN` is the same token `domain-provider-vercel.ts` already uses for
 * project domains, deliberately: a second variable holding the same secret is
 * the drift that file exists to prevent, and it is already read from a library
 * the tenant runtime imports, so reusing it here adds no exposure that did not
 * already exist.
 *
 * The zone is the REGISTRABLE domain — `aglyn.app` — and it is derived from
 * the tenant web apex rather than configured separately. A separately
 * configured zone could disagree with the apex the sending domains are built
 * under, and the failure that produces is records written into a zone that
 * does not contain the names they are for: invisible, and indistinguishable
 * from DNS that has not propagated.
 */
function settings(): ZoneSettings | null {
  const token = String(process.env.VERCEL_TOKEN ?? '').trim()
  const zone = tenantWebApex()
  if (!token || !zone) return null
  return { token, zone, teamId: process.env.VERCEL_TEAM_ID }
}

function query(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
}

interface ExistingRecord {
  id: string
  name: string
  type: string
  value: string
}

/**
 * How many records one page asks for.
 *
 * A number, not a guarantee. The provider answers with as many as it feels
 * like and says so in `pagination.next`, which is why this value is not the
 * thing that makes the read complete — the walk below is.
 */
const ZONE_PAGE_SIZE = 500

/**
 * A ceiling on the walk, so an endpoint that kept handing back cursors could
 * not turn a zone read into an unbounded loop. Exceeding it reads as
 * UNREADABLE rather than as the records collected so far, for the reason the
 * whole function exists: a partial zone is the input that makes
 * {@link alreadyPresent} answer false about a record that is already there.
 */
const ZONE_MAX_PAGES = 20

/**
 * Every record currently in the zone, or null when the read failed.
 *
 * ## One page is not the zone, and the page size cannot make it one
 *
 * This endpoint returns 20 records when asked for no limit, and honors a
 * larger `limit` only as far as it chooses to. There is no error and no
 * marker in the records themselves when it returns fewer than were asked
 * for — the truncation lives entirely in `pagination.next`, which is set
 * whenever the page came back full. So a single request cannot distinguish a
 * zone of 26 records from the first 26 of several hundred, and raising the
 * page size only moves the number at which it stops being able to.
 *
 * Getting that wrong is not untidiness. The caller writes only what
 * {@link alreadyPresent} says is missing, so a truncated read re-POSTs
 * records that exist — and a name carrying two DKIM TXT records is a name
 * whose DKIM does not verify, which breaks signing for every site under it.
 *
 * ## `until`, not `since`
 *
 * `pagination.next` is a millisecond timestamp pointing at OLDER records, and
 * `until` is the parameter that means "created before this". `since` means
 * the opposite, and passing the cursor to it returns the same page with the
 * same cursor forever — a loop that never terminates and never advances.
 *
 * ## Terminating
 *
 * A page that comes back exactly full carries a non-null cursor even when the
 * zone is exhausted, so `next === null` cannot be the only exit: the walk
 * also stops on a page with no records, which is what that cursor returns.
 * Records are collected by id, because a timestamp cursor can hand back a row
 * on both sides of a page boundary.
 *
 * One deadline for the whole walk rather than one per page, so
 * {@link SENDING_ZONE_TIMEOUT_MS} still bounds a zone read the way the
 * contract at the top of this file says it does.
 */
async function readZone(config: ZoneSettings): Promise<ExistingRecord[] | null> {
  const signal = deadline()
  const collected = new Map<string, ExistingRecord>()
  let cursor = ''

  for (let page = 0; page < ZONE_MAX_PAGES; page += 1) {
    // Built with `URLSearchParams` rather than by concatenating onto
    // `query()`, which emits an empty string when there is no team —
    // appending `&limit=500` to that produces `records&limit=500`, a path
    // with no query string at all, and the page size is silently dropped.
    const params = new URLSearchParams({ limit: String(ZONE_PAGE_SIZE) })
    if (config.teamId) params.set('teamId', config.teamId)
    if (cursor) params.set('until', cursor)

    let rows: Record<string, unknown>[]
    let next: unknown
    try {
      const response = await fetch(
        `https://api.vercel.com/v4/domains/${encodeURIComponent(config.zone)}/records?${params}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${config.token}` },
          signal,
        },
      )
      if (!response.ok) return null
      const body = await response.json().catch(() => null)
      rows = Array.isArray((body as { records?: unknown })?.records)
        ? ((body as { records: unknown[] }).records as Record<string, unknown>[])
        : []
      next = (body as { pagination?: { next?: unknown } })?.pagination?.next
    } catch {
      // A page that failed mid-walk is the whole read failing. Returning what
      // came back before it would be returning a truncated zone, which is the
      // exact state this function refuses to hand its caller.
      return null
    }

    for (const row of rows) {
      const id = String(row?.['id'] ?? '')
      collected.set(id || `${collected.size}`, {
        id,
        name: String(row?.['name'] ?? '').toLowerCase(),
        type: String(row?.['type'] ?? '').toUpperCase(),
        value: String(row?.['value'] ?? '').trim(),
      })
    }

    // No cursor, or a cursor that led to nothing: the zone is exhausted. An
    // empty FIRST page is an empty zone, which is readable and is not a
    // failure — the caller then writes every record, correctly.
    if (next === null || next === undefined || next === '' || !rows.length) {
      return [...collected.values()]
    }
    cursor = String(next)
  }

  return null
}

/**
 * A record already in the zone that makes ours unnecessary.
 *
 * Matched on name, type AND value together. Name and type alone would treat a
 * DKIM record carrying somebody else's key as ours already being present —
 * which is the one comparison that must not be loose, because a key that is
 * nearly right is a key that does not sign. The MX comparison ignores priority
 * for the same reason the verifier does: the exchange is what routes bounces.
 */
function alreadyPresent(
  existing: readonly ExistingRecord[],
  record: PlatformZoneRecord,
): boolean {
  const name = record.name.toLowerCase()
  const value = record.value.trim()
  return existing.some(
    (row) =>
      row.name === name &&
      row.type === record.type &&
      row.value.replace(/^"|"$/g, '') === value.replace(/^"|"$/g, ''),
  )
}

export const VERCEL_SENDING_ZONE_PROVIDER: SendingZoneProvider = {
  id: 'vercel',

  configured: () => Boolean(settings()),

  async write(records: readonly PlatformZoneRecord[]): Promise<ZoneWriteResult> {
    const config = settings()
    if (!config) return { outcome: 'skipped', created: 0, detail: 'unconfigured' }
    if (!records?.length) {
      return { outcome: 'failed', created: 0, detail: 'no-records' }
    }

    /*
     * Read the zone ONCE, before writing anything.
     *
     * A read that fails is not "the zone is empty" — treating it as such would
     * write a duplicate of every record on every retry, and a zone carrying two
     * DKIM TXT records at one name is a zone whose DKIM does not verify. So an
     * unreadable zone is a refusal, and the sweep tries again next run.
     */
    const existing = await readZone(config)
    if (!existing) {
      return { outcome: 'failed', created: 0, detail: 'zone-unreadable' }
    }

    let created = 0
    for (const record of records) {
      if (alreadyPresent(existing, record)) continue

      const body: Record<string, unknown> = {
        name: record.name,
        type: record.type,
        value: record.value,
        // Short enough that a mistake is correctable within an hour, long
        // enough that resolvers are not asked on every message.
        ttl: 3600,
      }
      if (record.type === 'MX') body['mxPriority'] = record.priority ?? 10

      try {
        const response = await fetch(
          `https://api.vercel.com/v2/domains/${encodeURIComponent(config.zone)}/records${query(config.teamId)}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: deadline(),
          },
        )
        if (response.ok) {
          created += 1
          continue
        }
        const payload = await response.json().catch(() => null)
        const detail = zoneDetail(response.status, payload)
        // A duplicate is success. The zone read above already skips records we
        // can see, so reaching this means one was created between the read and
        // the write — a concurrent sweep, which is exactly what idempotency is
        // for.
        if (detail.includes('record_already_exists') || response.status === 409) {
          continue
        }
        console.error(
          '[sending-zone:vercel] record write failed',
          record.type,
          record.name,
          detail,
        )
        return { outcome: 'failed', created, detail }
      } catch (error) {
        const detail = abortedDetail(error)
        console.error('[sending-zone:vercel] record write threw', record.name, detail)
        return { outcome: 'failed', created, detail }
      }
    }

    return { outcome: 'written', created, detail: null }
  },

  async remove(names: readonly string[]): Promise<ZoneWriteResult> {
    const config = settings()
    if (!config) return { outcome: 'skipped', created: 0, detail: 'unconfigured' }

    const wanted = new Set(
      (names ?? []).map((name) => String(name ?? '').trim().toLowerCase()).filter(Boolean),
    )
    if (!wanted.size) return { outcome: 'written', created: 0, detail: null }

    const existing = await readZone(config)
    if (!existing) {
      return { outcome: 'failed', created: 0, detail: 'zone-unreadable' }
    }

    /*
     * Exact name matches only, never a suffix match.
     *
     * A suffix match on `acme` would also delete `send.acme` — which is
     * intended — but also every record of a site called `notacme`, and, if the
     * name were ever empty, the entire zone. The caller passes every name it
     * means, and this deletes only those.
     */
    for (const row of existing) {
      if (!wanted.has(row.name) || !row.id) continue
      try {
        await fetch(
          `https://api.vercel.com/v2/domains/${encodeURIComponent(config.zone)}/records/${encodeURIComponent(row.id)}${query(config.teamId)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${config.token}` },
            signal: deadline(),
          },
        )
      } catch {
        // Best effort per record: a zone half-cleaned is better than a zone
        // that stopped at the first failure, and the next teardown pass sees
        // whatever is left.
        console.error('[sending-zone:vercel] record delete threw', row.name)
      }
    }

    return { outcome: 'written', created: 0, detail: null }
  },
}

/*==========================================
  The driver that writes nothing
==========================================*/

export const NO_SENDING_ZONE_PROVIDER: SendingZoneProvider = {
  id: 'none',
  configured: () => false,
  write: async () => ({ outcome: 'skipped', created: 0, detail: 'unconfigured' }),
  remove: async () => ({ outcome: 'skipped', created: 0, detail: 'unconfigured' }),
}

/**
 * The zone driver this deployment uses.
 *
 * Detection is the presence of the credential, matching
 * `sendingDomainProvider`. A self-host running its sites on DNS we do not
 * control gets `none`, and its operator publishes the records by hand from the
 * same table a custom-domain customer sees — the automatic path is a
 * convenience of owning the zone, not a requirement of the feature.
 */
export function sendingZoneProvider(): SendingZoneProvider {
  return settings() ? VERCEL_SENDING_ZONE_PROVIDER : NO_SENDING_ZONE_PROVIDER
}

/** Refuse to touch a zone that is not ours. Exported so the join can assert it. */
export function isOurZone(domain: string): boolean {
  return isPlatformSendingDomain(domain)
}
