/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * The zone driver, and specifically that it reads the WHOLE zone.
 *
 * `fetch` is stubbed by a GUARD, not a permissive mock: any request to a host
 * other than the Vercel API throws, so a driver that reached the live API
 * would fail here rather than quietly succeed on somebody's network. The
 * guard is itself asserted, matching `sending-domain-provider.spec.ts`.
 *
 * The pagination shape asserted here is the one the live endpoint actually
 * has, measured against the real zone:
 *
 * - a page that comes back FULL carries a non-null `pagination.next` even
 *   when nothing is left, so the cursor alone cannot terminate the walk;
 * - `pagination.next` is a millisecond timestamp read by `until`, and `since`
 *   returns the same page with the same cursor forever.
 */

const TOKEN = 'vercel_notarealtoken_0123456789abcdef'
const ZONE = 'aglyn.app'
const DKIM_NAME = 'resend._domainkey.send.acme.mail'
const DKIM_VALUE = 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCexamplekeymaterial'

type StubbedCall = { url: string; method: string }

let calls: StubbedCall[] = []
let responses: { ok: boolean; status: number; json: unknown }[] = []

function installFetchGuard() {
  const stub = jest.fn(async (url: any, init: any) => {
    const target = String(url)
    if (!target.startsWith('https://api.vercel.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${target}`)
    }
    calls.push({ url: target, method: String(init?.method ?? 'GET') })
    const next = responses.shift()
    if (!next) {
      throw new Error(`No stubbed response for ${init?.method ?? 'GET'} ${target}`)
    }
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.json,
      text: async () => JSON.stringify(next.json),
    }
  })
  global.fetch = stub as unknown as typeof fetch
  return stub
}

/** One page of the records endpoint. `next: null` means nothing follows. */
function page(
  records: Record<string, unknown>[],
  next: number | null,
): { ok: boolean; status: number; json: unknown } {
  return {
    ok: true,
    status: 200,
    json: { records, pagination: { count: records.length, next, prev: null } },
  }
}

function txt(id: string, name: string, value: string) {
  return { id, name, type: 'TXT', value }
}

/** The three records one provisioned sending domain puts in the zone. */
const RECORDS = [
  { type: 'TXT' as const, name: DKIM_NAME, value: DKIM_VALUE },
  { type: 'TXT' as const, name: 'send.acme.mail', value: 'v=spf1 include:amazonses.com ~all' },
  {
    type: 'MX' as const,
    name: 'send.acme.mail',
    value: 'feedback-smtp.us-east-1.amazonses.com',
    priority: 10,
  },
]

import {
  NO_SENDING_ZONE_PROVIDER,
  sendingZoneProvider,
  VERCEL_SENDING_ZONE_PROVIDER,
} from './sending-zone-provider'

const originalFetch = global.fetch
const originalEnv = { ...process.env }
let errors: unknown[][]

beforeEach(() => {
  calls = []
  responses = []
  errors = []
  installFetchGuard()
  process.env.VERCEL_TOKEN = TOKEN
  process.env.NEXT_PUBLIC_TENANT_DOMAIN = ZONE
  delete process.env.VERCEL_TEAM_ID
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args)
  })
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

/** The guard is asserted, because a control that cannot fail proves nothing. */
describe('the fetch guard', () => {
  it('throws on a host that is not the Vercel API', async () => {
    await expect(fetch('https://api.resend.com/domains' as any)).rejects.toThrow(
      /Blocked outbound request/,
    )
  })
})

describe('readZone pagination', () => {
  it('follows the cursor and sees a record that the first page did not carry', async () => {
    // The DKIM record is on the SECOND page. Under a single-shot read it is
    // invisible, and all three records are POSTed on top of a zone that
    // already holds them — two DKIM TXT records at one name, which is the
    // failure this walk exists to prevent.
    responses.push(
      page([txt('r1', 'send.acme.mail', 'v=spf1 include:amazonses.com ~all')], 1_700_000_000_000),
      page(
        [
          txt('r2', DKIM_NAME, DKIM_VALUE),
          {
            id: 'r3',
            name: 'send.acme.mail',
            type: 'MX',
            value: 'feedback-smtp.us-east-1.amazonses.com',
          },
        ],
        null,
      ),
    )

    const result = await VERCEL_SENDING_ZONE_PROVIDER.write(RECORDS)

    expect(result).toEqual({ outcome: 'written', created: 0, detail: null })
    // Two reads and NOT ONE write. A POST here would be the duplicate.
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('carries the cursor as `until`, never as `since`', async () => {
    responses.push(
      page([txt('r1', 'other', 'v=spf1 -all')], 1_700_000_000_000),
      page([], null),
    )

    await VERCEL_SENDING_ZONE_PROVIDER.write([RECORDS[0]]).catch(() => null)

    const second = new URL(calls[1].url)
    expect(second.searchParams.get('until')).toBe('1700000000000')
    // `since` walks the other way: the same page, with the same cursor, for
    // as many rounds as the page cap allows.
    expect(second.searchParams.get('since')).toBeNull()
  })

  it('stops on an empty page, which is what a page that came back full returns', async () => {
    // The live endpoint sets `next` whenever the page filled to the limit,
    // including when the zone is exhausted. The follow-up read is empty.
    responses.push(
      page([txt('r1', DKIM_NAME, DKIM_VALUE)], 1_700_000_000_000),
      page([], 1_699_999_999_999),
    )

    const result = await VERCEL_SENDING_ZONE_PROVIDER.write([RECORDS[0]])

    expect(result.outcome).toBe('written')
    expect(result.created).toBe(0)
    // Three would mean the non-null cursor on the EMPTY page was followed.
    expect(calls).toHaveLength(2)
  })

  it('reads an unpaginated zone in ONE request', async () => {
    // The control on the fix: pagination applied indiscriminately — a second
    // round trip on a zone that already said `next: null` — fails here.
    responses.push(page([txt('r1', DKIM_NAME, DKIM_VALUE)], null))

    const result = await VERCEL_SENDING_ZONE_PROVIDER.write([RECORDS[0]])

    expect(result).toEqual({ outcome: 'written', created: 0, detail: null })
    expect(calls).toHaveLength(1)
  })

  it('refuses when a page fails mid-walk, rather than writing on the part it read', async () => {
    responses.push(
      page([txt('r1', 'send.acme.mail', 'v=spf1 include:amazonses.com ~all')], 1_700_000_000_000),
      { ok: false, status: 500, json: { error: { code: 'internal' } } },
    )

    const result = await VERCEL_SENDING_ZONE_PROVIDER.write(RECORDS)

    expect(result).toEqual({
      outcome: 'failed',
      created: 0,
      detail: 'zone-unreadable',
    })
    // Nothing was POSTed on the strength of a partial zone.
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('refuses a zone that never stops handing back cursors', async () => {
    for (let index = 0; index < 40; index += 1) {
      responses.push(page([txt(`r${index}`, `n${index}`, 'x')], 1_700_000_000_000 - index))
    }

    const result = await VERCEL_SENDING_ZONE_PROVIDER.write(RECORDS)

    expect(result.detail).toBe('zone-unreadable')
    expect(result.created).toBe(0)
    // Bounded: the walk gave up rather than looping on the endpoint's terms.
    expect(calls.length).toBeLessThanOrEqual(20)
  })

  it('writes only what the whole zone is missing', async () => {
    responses.push(
      page([txt('r1', DKIM_NAME, DKIM_VALUE)], 1_700_000_000_000),
      page([txt('r2', 'send.acme.mail', 'v=spf1 include:amazonses.com ~all')], null),
      { ok: true, status: 200, json: { uid: 'r3' } },
    )

    const result = await VERCEL_SENDING_ZONE_PROVIDER.write(RECORDS)

    expect(result).toEqual({ outcome: 'written', created: 1, detail: null })
    const posts = calls.filter((call) => call.method === 'POST')
    expect(posts).toHaveLength(1)
  })

  it('treats an empty zone as readable and writes everything into it', async () => {
    responses.push(
      page([], null),
      { ok: true, status: 200, json: { uid: 'a' } },
      { ok: true, status: 200, json: { uid: 'b' } },
      { ok: true, status: 200, json: { uid: 'c' } },
    )

    const result = await VERCEL_SENDING_ZONE_PROVIDER.write(RECORDS)

    expect(result).toEqual({ outcome: 'written', created: 3, detail: null })
  })
})

describe('remove', () => {
  it('deletes a record the first page did not carry', async () => {
    responses.push(
      page([txt('r1', 'unrelated.mail', 'x')], 1_700_000_000_000),
      page([txt('r2', 'send.acme.mail', 'v=spf1')], null),
      { ok: true, status: 200, json: {} },
    )

    const result = await VERCEL_SENDING_ZONE_PROVIDER.remove(['send.acme.mail'])

    expect(result.outcome).toBe('written')
    const deletes = calls.filter((call) => call.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain('/records/r2')
  })
})

describe('selection', () => {
  it('is the Vercel driver when a token is configured', () => {
    expect(sendingZoneProvider().id).toBe('vercel')
  })

  it('is the driver that writes nothing when it is not', () => {
    delete process.env.VERCEL_TOKEN
    expect(sendingZoneProvider()).toBe(NO_SENDING_ZONE_PROVIDER)
  })
})
