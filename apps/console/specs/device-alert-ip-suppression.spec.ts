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
 * AGL-1959, part 2 — IP-overlap suppression for the new-device alert.
 *
 * AGL-665 decided "cookie-based detection, but suppress the email when the
 * sign-in shares an IP with a known device (same machine, cleared cookies)
 * rather than blasting on every miss", and shipped only the detection. The
 * only gate in `recordDeviceAndMaybeAlert` was `hasPriorDevice`, so every
 * cleared cookie, private window, new profile and second browser mailed a
 * security alert — on the one email AGL-665 says "must be believed".
 *
 * The dangerous way to fix that is a bare same-IP rule, which hands anyone
 * behind the victim's NAT a permanently silent sign-in. So the cases below are
 * split deliberately: the ones that prove the noise is gone, and the ones that
 * prove the hole was not opened. The second group is the point of the file.
 */

const sent: Array<Record<string, unknown>> = []

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: async (message: Record<string, unknown>) => {
    sent.push(message)
    return { sent: true }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  meterPlatformEmail: async () => undefined,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  PLATFORM_BRAND_NAME: 'Aglyn',
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

import {
  newDeviceAlertSuppression,
  osOf,
  SUPPRESSION_CAP,
  SUPPRESSION_RECENCY_MS,
  SUPPRESSION_WINDOW_MS,
  type KnownDevice,
} from '../app/api/_lib/device-alert-suppression'
import {
  recordDeviceAndMaybeAlert,
  summarizeUserAgent,
} from '../app/api/_lib/security-alerts'

const NOW = 1_760_000_000_000
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function known(over: Partial<KnownDevice> = {}): KnownDevice {
  return {
    id: 'dev-known',
    ip: '203.0.113.7',
    deviceName: summarizeUserAgent(MAC_CHROME),
    lastSeenAt: NOW - 60_000,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// A faithful-enough Firestore for one user's `devices` subcollection.
//
// Models the three behaviours the code under test actually depends on, and no
// more: `set` with `{ merge: true }` MERGES rather than replaces, `set` without
// it REPLACES, and a `limit(n).get()` returns `{ empty, docs }` with each doc
// carrying `id` and `data()`. An unfaithful double here would fabricate a
// green for the suppression cap, which is counted off `alertSuppressedAt`
// written by exactly one of those calls.
// ---------------------------------------------------------------------------
function fakeFirestore(seed: Record<string, Record<string, unknown>>) {
  const store: Record<string, Record<string, unknown>> = { ...seed }
  const docRef = (id: string) => ({
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(store, id),
      id,
      data: () => store[id],
    }),
    set: async (
      value: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      store[id] = options?.merge ? { ...(store[id] ?? {}), ...value } : { ...value }
    },
  })
  const collection = {
    doc: (id: string) => docRef(id),
    limit: (n: number) => ({
      get: async () => {
        const ids = Object.keys(store).slice(0, n)
        return {
          empty: ids.length === 0,
          docs: ids.map((id) => ({ id, data: () => store[id] })),
        }
      },
    }),
  }
  return {
    store,
    firestore: {
      collection: () => ({
        doc: () => ({ collection: () => collection }),
      }),
    } as unknown as FirebaseFirestore.Firestore,
  }
}

function record(opts: {
  seed?: Record<string, Record<string, unknown>>
  deviceId?: string
  userAgent?: string
  ip?: string
  nowMs?: number
}) {
  const { store, firestore } = fakeFirestore(opts.seed ?? {})
  const userAgent = opts.userAgent ?? MAC_CHROME
  return recordDeviceAndMaybeAlert({
    firestore,
    uid: 'u1',
    email: 'owner@example.com',
    deviceId: opts.deviceId ?? 'dev-new',
    client: {
      deviceName: summarizeUserAgent(userAgent),
      userAgent,
      location: 'Dallas, TX, US',
      ip: opts.ip ?? '203.0.113.7',
    },
    nowMs: opts.nowMs ?? NOW,
  }).then((outcome) => ({ outcome, store }))
}

beforeEach(() => {
  sent.length = 0
})

describe('the predicate', () => {
  it('suppresses a second browser profile on the same machine and network', () => {
    const verdict = newDeviceAlertSuppression({
      ip: '203.0.113.7',
      deviceName: summarizeUserAgent(MAC_CHROME),
      known: [known()],
      nowMs: NOW,
    })

    expect(verdict).toEqual({
      suppress: true,
      matchedDeviceId: 'dev-known',
      reason: 'ip-and-os-overlap',
    })
  })

  it('suppresses a DIFFERENT browser on the same machine — the AGL-665 case', () => {
    // Safari against a known Chrome: same OS, same IP. This is "a second
    // browser on the same machine", named in the issue as a false positive.
    const verdict = newDeviceAlertSuppression({
      ip: '203.0.113.7',
      deviceName: summarizeUserAgent(MAC_SAFARI),
      known: [known()],
      nowMs: NOW,
    })

    expect(verdict.suppress).toBe(true)
  })

  it('does NOT suppress a different system behind the same IP — the NAT case', () => {
    // The whole reason this is not a bare same-IP rule. A stranger on the
    // office or café NAT shares the egress address and almost never the
    // machine.
    const verdict = newDeviceAlertSuppression({
      ip: '203.0.113.7',
      deviceName: summarizeUserAgent(WINDOWS_CHROME),
      known: [known()],
      nowMs: NOW,
    })

    expect(verdict).toEqual({ suppress: false, reason: 'no-overlap' })
  })

  it('does NOT suppress on a different IP', () => {
    const verdict = newDeviceAlertSuppression({
      ip: '198.51.100.9',
      deviceName: summarizeUserAgent(MAC_CHROME),
      known: [known()],
      nowMs: NOW,
    })

    expect(verdict).toEqual({ suppress: false, reason: 'no-overlap' })
  })

  it('does NOT suppress against a device last seen too long ago', () => {
    // A residential address reassigned months later is a different household.
    const verdict = newDeviceAlertSuppression({
      ip: '203.0.113.7',
      deviceName: summarizeUserAgent(MAC_CHROME),
      known: [known({ lastSeenAt: NOW - SUPPRESSION_RECENCY_MS - 1 })],
      nowMs: NOW,
    })

    expect(verdict).toEqual({ suppress: false, reason: 'no-overlap' })
  })

  it('does NOT suppress when the IP is unknown', () => {
    // `describeSignInClient` writes the literal 'Unknown' when no forwarding
    // header is present. Two unknowns are not a match.
    const verdict = newDeviceAlertSuppression({
      ip: 'Unknown',
      deviceName: summarizeUserAgent(MAC_CHROME),
      known: [known({ ip: 'Unknown' })],
      nowMs: NOW,
    })

    expect(verdict).toEqual({ suppress: false, reason: 'no-usable-ip' })
  })

  it('does NOT suppress when the agent is unreadable — silence is not the default', () => {
    // A scripted client arrives with no usable agent. An unparseable OS must
    // buy an alert, never a pass.
    const verdict = newDeviceAlertSuppression({
      ip: '203.0.113.7',
      deviceName: summarizeUserAgent(''),
      known: [known({ deviceName: 'Unknown device' })],
      nowMs: NOW,
    })

    expect(verdict).toEqual({ suppress: false, reason: 'no-usable-os' })
  })

  it('stops suppressing once the daily cap is reached', () => {
    // The bound on what a genuine attacker who DOES share the NAT and the
    // system can hide. Without it, one matching device licenses unlimited
    // quiet sign-ins forever.
    const suppressed = Array.from({ length: SUPPRESSION_CAP }, (_, i) =>
      known({ id: `s${i}`, alertSuppressedAt: NOW - 60_000 }),
    )
    const verdict = newDeviceAlertSuppression({
      ip: '203.0.113.7',
      deviceName: summarizeUserAgent(MAC_CHROME),
      known: [known(), ...suppressed],
      nowMs: NOW,
    })

    expect(verdict).toEqual({ suppress: false, reason: 'cap-reached' })
  })

  it('the cap is a ROLLING window, not a lifetime total', () => {
    const old = Array.from({ length: SUPPRESSION_CAP + 5 }, (_, i) =>
      known({
        id: `s${i}`,
        alertSuppressedAt: NOW - SUPPRESSION_WINDOW_MS - 1,
      }),
    )
    const verdict = newDeviceAlertSuppression({
      ip: '203.0.113.7',
      deviceName: summarizeUserAgent(MAC_CHROME),
      known: [known(), ...old],
      nowMs: NOW,
    })

    expect(verdict.suppress).toBe(true)
  })

  it('reads the OS out of a summary and refuses the unreadable ones', () => {
    expect(osOf('Chrome on macOS')).toBe('macOS')
    expect(osOf('Safari on iOS')).toBe('iOS')
    expect(osOf('Unknown device')).toBeNull()
    expect(osOf('Chrome on an unknown OS')).toBeNull()
    expect(osOf('')).toBeNull()
  })
})

describe('wired into the sign-in record', () => {
  it('mails nothing for the same machine on the same network', async () => {
    const { outcome } = await record({
      seed: { 'dev-known': { ...known(), createdAt: NOW - 120_000 } },
    })

    expect(outcome.newDevice).toBe(true)
    expect(outcome.alerted).toBe(false)
    expect(outcome.suppression).toEqual({
      suppress: true,
      matchedDeviceId: 'dev-known',
      reason: 'ip-and-os-overlap',
    })
    expect(sent).toHaveLength(0)
  })

  it('still RECORDS the device, and stamps why it was silent', async () => {
    // The property that keeps this a noise fix rather than a detection hole.
    // A suppressed sign-in the owner cannot see afterwards would be strictly
    // worse than the noise it removes.
    const { store } = await record({
      seed: { 'dev-known': { ...known(), createdAt: NOW - 120_000 } },
    })

    expect(store['dev-new']).toMatchObject({
      deviceName: 'Chrome on macOS',
      ip: '203.0.113.7',
      alertSuppressedAt: NOW,
      alertSuppressedBy: 'dev-known',
    })
  })

  it('mails the alert for a stranger on the same NAT', async () => {
    const { outcome, store } = await record({
      seed: { 'dev-known': { ...known(), createdAt: NOW - 120_000 } },
      deviceId: 'dev-stranger',
      userAgent: WINDOWS_CHROME,
    })

    expect(outcome.alerted).toBe(true)
    expect(sent).toHaveLength(1)
    expect(store['dev-stranger']).not.toHaveProperty('alertSuppressedAt')
  })

  it('a known device is still silent and still touched', async () => {
    const { outcome, store } = await record({
      seed: {
        'dev-new': { ...known({ id: 'dev-new' }), lastSeenAt: NOW - 500_000 },
      },
    })

    expect(outcome).toEqual({ newDevice: false, alerted: false })
    expect(store['dev-new']).toMatchObject({ lastSeenAt: NOW })
    // `set(..., { merge: true })` — the descriptive fields survive the touch.
    expect(store['dev-new']).toHaveProperty('deviceName', 'Chrome on macOS')
    expect(sent).toHaveLength(0)
  })

  it('the FIRST device on an account is still silent', async () => {
    const { outcome } = await record({ seed: {} })

    expect(outcome).toEqual({ newDevice: true, alerted: false })
    expect(sent).toHaveLength(0)
  })

  it('reads more than one existing device — a bounded scan, not limit(1)', async () => {
    // The old code read `devices.limit(1)`, so it could only ever answer "does
    // any device exist". A match against the SECOND device is the case that
    // read cannot see, and the case a person with a phone and a laptop hits.
    const { outcome } = await record({
      seed: {
        'dev-phone': {
          ...known({
            id: 'dev-phone',
            ip: '198.51.100.9',
            deviceName: 'Safari on iOS',
          }),
          createdAt: NOW - 500_000,
        },
        'dev-known': { ...known(), createdAt: NOW - 120_000 },
      },
    })

    expect(outcome.alerted).toBe(false)
    expect(outcome.suppression?.suppress).toBe(true)
  })
})
