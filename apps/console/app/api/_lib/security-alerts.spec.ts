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

const mockSendEmail = jest.fn<
  Promise<{ sent: boolean; id?: string | null; reason?: string }>,
  [Record<string, unknown>]
>(async () => ({ sent: true, id: 'em_1' }))
jest.mock('@aglyn/shared-util-email', () => ({
  sendEmail: (options: unknown) =>
    mockSendEmail(options as Record<string, unknown>),
}))
// The cost meter (AGL-1438). Mocked rather than reached: importing the real
// barrel pulls `next/cache` into a plain node test env. What matters here is
// that a DELIVERED alert counts and a skipped one does not.
const mockMeterPlatformEmail = jest.fn(async () => undefined)
jest.mock('@aglyn/tenant-data-admin', () => ({
  meterPlatformEmail: () => mockMeterPlatformEmail(),
}))
// No designed template published — every send exercises the fallback copy.
jest.mock('./render-system-email', () => ({
  renderSystemEmail: async () => null,
}))

import {
  describeSignInClient,
  formatAlertTime,
  recordDeviceAndMaybeAlert,
  sendPasskeyAddedAlert,
  summarizeUserAgent,
  type SignInClient,
} from './security-alerts'

const NOW = Date.UTC(2026, 7, 8, 14, 3)

const CLIENT: SignInClient = {
  deviceName: 'Chrome on macOS',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/126.0 Safari/537.36',
  location: 'Denver, CO, US',
  ip: '203.0.113.7',
}

/**
 * In-memory stand-in for `users/{uid}/devices`: just enough surface for the
 * doc get/set and the limit(1) "any prior device?" probe the code makes.
 */
function firestoreWithDevices(seed: Record<string, Record<string, unknown>>) {
  const docs: Record<string, Record<string, unknown>> = { ...seed }
  const writes: Array<{ id: string; data: Record<string, unknown>; merge: boolean }> =
    []
  const devicesCollection = {
    doc: (id: string) => ({
      get: async () => ({ exists: id in docs }),
      set: async (
        data: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        writes.push({ id, data, merge: Boolean(options?.merge) })
        docs[id] = options?.merge ? { ...docs[id], ...data } : data
      },
    }),
    /*
     * `{ empty, docs }`, not `{ empty }` alone (AGL-1959).
     *
     * The probe used to ask one question — "is there any prior device?" — so
     * a double that answered only `empty` was faithful. IP-overlap suppression
     * reads the SET, and a double that returns no `docs` makes
     * `recordDeviceAndMaybeAlert` throw into its own catch and report
     * `{ newDevice: false, alerted: false }`: a false RED that looks like a
     * behaviour change and is really a missing field on the fake.
     */
    limit: (n: number) => ({
      get: async () => {
        const ids = Object.keys(docs).slice(0, n)
        return {
          empty: ids.length === 0,
          docs: ids.map((id) => ({ id, data: () => docs[id] })),
        }
      },
    }),
  }
  const firestore = {
    collection: () => ({ doc: () => ({ collection: () => devicesCollection }) }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, docs, writes }
}

function params(
  firestore: FirebaseFirestore.Firestore,
  overrides: Partial<Parameters<typeof recordDeviceAndMaybeAlert>[0]> = {},
) {
  return {
    firestore,
    uid: 'uid-1',
    email: 'person@example.com',
    deviceId: 'device-new',
    client: CLIENT,
    nowMs: NOW,
    ...overrides,
  }
}

beforeEach(() => {
  mockSendEmail.mockClear()
  mockMeterPlatformEmail.mockClear()
})

describe('recordDeviceAndMaybeAlert (AGL-665)', () => {
  it('alerts on a genuinely new device when the account already has one', async () => {
    const { firestore, docs } = firestoreWithDevices({
      'device-old': { createdAt: 1 },
    })
    const outcome = await recordDeviceAndMaybeAlert(params(firestore))

    // The suppression verdict rides along on every outcome that reached the
    // decision (AGL-1959), so `alerted: false` can be told apart from a first
    // device and from a send that failed. `device-old` carries neither an IP
    // nor a device name, so nothing overlaps and the alert goes out.
    expect(outcome).toEqual({
      newDevice: true,
      alerted: true,
      suppression: { suppress: false, reason: 'no-overlap' },
    })
    expect(docs['device-new']).toMatchObject({
      deviceName: 'Chrome on macOS',
      createdAt: NOW,
      lastSeenAt: NOW,
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    // Cost meter (AGL-1438): a delivered alert is a real Resend send, and
    // once — a second call here would double-count it.
    expect(mockMeterPlatformEmail).toHaveBeenCalledTimes(1)
    const options = mockSendEmail.mock.calls[0][0] as Record<string, unknown>
    expect(options.to).toBe('person@example.com')
    expect(options.subject).toBe('New sign-in to your Aglyn account')
    expect(options.context).toBe('security-new-device')
    // Factual and actionable: the facts, and a real surface to act on.
    expect(String(options.text)).toContain('Chrome on macOS')
    expect(String(options.text)).toContain('Denver, CO, US')
    expect(String(options.text)).toContain('203.0.113.7')
    expect(String(options.text)).toContain('2026-08-08 14:03 UTC')
    // The SECTION, not the page (AGL-2501). Landing someone who has just been
    // told a stranger signed in on their email address, to go looking for
    // Recent sign-ins themselves, is the thing this link exists to prevent.
    expect(String(options.text)).toContain('/manage/user/security')
  })

  it('is silent for a known device, and only touches lastSeenAt', async () => {
    const { firestore, writes } = firestoreWithDevices({
      'device-known': { createdAt: 1, lastSeenAt: 1 },
    })
    const outcome = await recordDeviceAndMaybeAlert(
      params(firestore, { deviceId: 'device-known' }),
    )

    expect(outcome).toEqual({ newDevice: false, alerted: false })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ id: 'device-known', merge: true })
    expect(writes[0].data.lastSeenAt).toBe(NOW)
    expect(writes[0].data.createdAt).toBeUndefined()
  })

  it('records but never alerts on the first device ever seen', async () => {
    // Account creation, or the rollout backfill of an existing account —
    // "new device" mail on either teaches people to ignore the alert.
    const { firestore, docs } = firestoreWithDevices({})
    const outcome = await recordDeviceAndMaybeAlert(params(firestore))

    expect(outcome).toEqual({ newDevice: true, alerted: false })
    expect(docs['device-new']).toBeDefined()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('records but does not alert when the token carries no email', async () => {
    const { firestore, docs } = firestoreWithDevices({
      'device-old': { createdAt: 1 },
    })
    const outcome = await recordDeviceAndMaybeAlert(
      params(firestore, { email: null }),
    )

    expect(outcome).toEqual({ newDevice: true, alerted: false })
    expect(docs['device-new']).toBeDefined()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('swallows a Firestore failure rather than breaking sign-in', async () => {
    const broken = {
      collection: () => {
        throw new Error('firestore down')
      },
    } as unknown as FirebaseFirestore.Firestore
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordDeviceAndMaybeAlert(params(broken))).resolves.toEqual({
      newDevice: false,
      alerted: false,
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('reports a refused send as not alerted, without throwing', async () => {
    mockSendEmail.mockResolvedValueOnce({ sent: false, reason: 'rejected' })
    const { firestore } = firestoreWithDevices({ 'device-old': { createdAt: 1 } })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const outcome = await recordDeviceAndMaybeAlert(params(firestore))
    expect(outcome).toEqual({
      newDevice: true,
      alerted: false,
      suppression: { suppress: false, reason: 'no-overlap' },
    })
    // An email Resend refused is not a cost (AGL-1438).
    expect(mockMeterPlatformEmail).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('sendPasskeyAddedAlert (AGL-665, trigger awaits AGL-662)', () => {
  it('sends the passkey alert with the label, time and security link', async () => {
    const result = await sendPasskeyAddedAlert({
      to: 'person@example.com',
      label: 'MacBook Touch ID',
      time: formatAlertTime(NOW),
    })
    expect(result).toEqual({ sent: true, id: 'em_1' })
    const options = mockSendEmail.mock.calls[0][0] as Record<string, unknown>
    expect(options.to).toBe('person@example.com')
    expect(options.subject).toBe('A passkey was added to your Aglyn account')
    expect(options.context).toBe('security-passkey-added')
    expect(String(options.text)).toContain('MacBook Touch ID')
    expect(String(options.text)).toContain('2026-08-08 14:03 UTC')
    expect(String(options.text)).toContain('/manage/user/security')
  })
})

describe('describeSignInClient', () => {
  function headers(map: Record<string, string>) {
    return { get: (name: string) => map[name.toLowerCase()] ?? null }
  }

  it('reads device, geo and ip off the request headers', () => {
    const client = describeSignInClient(
      headers({
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/126.0 Safari/537.36',
        'x-vercel-ip-city': 'Denver',
        'x-vercel-ip-country-region': 'CO',
        'x-vercel-ip-country': 'US',
        // A caller-typed value in front of the address a proxy observed. The
        // address in this email is stored on the device record and read back
        // by the breach-notification report, so a forged hop reaching it is a
        // durable false claim about where somebody signed in from — not just a
        // rate-limit bypass.
        'x-forwarded-for': '198.51.100.66, 203.0.113.7',
      }),
    )
    expect(client.deviceName).toBe('Chrome on macOS')
    expect(client.location).toBe('Denver, CO, US')
    expect(client.ip).toBe('203.0.113.7')
    expect(client.ip).not.toBe('198.51.100.66')
  })

  it('decodes URI-encoded city names', () => {
    const client = describeSignInClient(
      headers({ 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country': 'BR' }),
    )
    expect(client.location).toBe('São Paulo, BR')
  })

  it('falls back honestly when geo headers are absent (local dev)', () => {
    const client = describeSignInClient(headers({}))
    expect(client.deviceName).toBe('Unknown device')
    expect(client.location).toBe('Unknown location')
    expect(client.ip).toBe('Unknown')
  })

  /**
   * SELF-HOST: no container has an `x-vercel-*` header. Reading only those
   * names put "Unknown location" in every alert email on every Docker install
   * — and stored it, which is what the breach-notification report parses a
   * data subject's country out of. Neither surface errors, so the whole
   * failure was invisible to an operator.
   */
  it('reads geo from a non-Vercel edge', () => {
    const client = describeSignInClient(
      headers({
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36',
        'cf-ipcity': 'Dublin',
        'cf-ipcountry': 'IE',
      }),
    )
    expect(client.location).toBe('Dublin, IE')
    // The country is the last comma-separated token, which is the contract
    // `deviceLocationCountry` reads the filing country back on.
    expect(client.location.split(', ').pop()).toBe('IE')
  })

  it('reports the country alone when the edge sends no city', () => {
    const client = describeSignInClient(headers({ 'cloudfront-viewer-country': 'de' }))
    expect(client.location).toBe('DE')
  })
})

describe('summarizeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Version/17.5 Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Firefox/127.0', 'Firefox on Linux'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36 Edg/126.0', 'Edge on Windows'],
  ])('summarizes %s', (ua, expected) => {
    expect(summarizeUserAgent(ua)).toBe(expected)
  })

  it('never fabricates a device from an empty string', () => {
    expect(summarizeUserAgent('')).toBe('Unknown device')
    expect(summarizeUserAgent(undefined)).toBe('Unknown device')
  })
})
