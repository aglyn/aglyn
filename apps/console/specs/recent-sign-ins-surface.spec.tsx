/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * THE SECOND HALF OF THE NEW-DEVICE EMAIL (AGL-2318).
 *
 * `recordDeviceAndMaybeAlert` writes `userAgent`, `deviceName`, `ip`,
 * `location`, `createdAt` and `lastSeenAt` on every sign-in of every account.
 * It read back exactly two things — `snapshot.exists` and
 * `devices.limit(1).get()` — both pure existence checks gating the alert
 * email. Six descriptive fields, written constantly, displayed nowhere.
 *
 * So a person received "new sign-in from Chrome on Windows, Dallas, TX" and
 * had NOWHERE TO GO: no device list, no location or user-agent to compare
 * against, no revoke. That is half a security notification.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 * Writer and reader are both in this app, so every test drives the REAL
 * `recordDeviceAndMaybeAlert` and then the REAL route.
 *
 *  - EACH ROW'S OWN FACTS. Two sign-ins from different browsers, cities and
 *    times, and each row must carry its own. A surface showing the first
 *    device's details beside every row would look entirely right and be wrong
 *    for every row but one — and being wrong HERE means telling somebody a
 *    stranger's sign-in was theirs.
 *  - THE MEASURED USER-AGENT, not a constant. `describeSignInClient` reads it
 *    off the request; a writer that recorded a fixed string would make every
 *    device in the list look identical, which is exactly the state that makes
 *    an intrusion invisible.
 *  - THE TOKEN'S uid, never a parameter. That is the entire access control on
 *    this endpoint.
 *  - NEWEST FIRST, because the row somebody is checking is the most recent.
 */

const mockVerifyIdToken = jest.fn()

/** `users/{uid}/devices/{deviceId}` → data. */
const mockStore: Record<string, Record<string, unknown>> = {}

const deviceRef = (path: string) => ({
  path,
  id: path.split('/').pop() ?? path,
  get: async () => ({
    exists: mockStore[path] !== undefined,
    id: path.split('/').pop(),
    data: () => mockStore[path],
  }),
  set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
    mockStore[path] = options?.merge
      ? { ...(mockStore[path] ?? {}), ...data }
      : { ...data }
  },
})

/**
 * The devices collection.
 *
 * `orderBy('lastSeenAt','desc')` is modelled rather than accepted-and-ignored:
 * the route's whole "newest first" promise rides on it, and a double that
 * returned insertion order would let a dropped `orderBy` pass while the real
 * page showed a stranger's sign-in below the user's own.
 */
const devicesCollection = (uid: string, order = false): any => ({
  doc: (id: string) => deviceRef(`users/${uid}/devices/${id}`),
  orderBy: () => devicesCollection(uid, true),
  limit: () => devicesCollection(uid, order),
  get: async () => {
    const entries = Object.entries(mockStore).filter(([path]) =>
      path.startsWith(`users/${uid}/devices/`),
    )
    if (order) {
      entries.sort(
        (a, b) =>
          Number(b[1]['lastSeenAt'] ?? 0) - Number(a[1]['lastSeenAt'] ?? 0),
      )
    }
    const docs = entries.map(([path, data]) => ({
      id: path.split('/').pop(),
      data: () => data,
    }))
    return { docs, size: docs.length, empty: docs.length === 0 }
  },
})

const fakeFirestore: any = {
  collection: (name: string) => ({
    doc: (uid: string) => ({
      collection: (child: string) =>
        name === 'users' && child === 'devices'
          ? devicesCollection(uid)
          : devicesCollection('(none)'),
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  meterPlatformEmail: async () => undefined,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => fakeFirestore,
    }),
  },
}))

// The REAL barrel rides along: `security-alerts` reaches `render-system-email`,
// which needs `brandMergeTokens` and the branding profile at MODULE LOAD. A
// wholesale mock here is a closed world, and the failure it produces —
// "brandMergeTokens is not a function" — points at neither the writer nor the
// reader this file is about.
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

/**
 * The alert email is stubbed, not the recorder.
 *
 * The recorder is the writer under test; the send is a side effect this file
 * has no opinion about, and letting it run would put a Resend call on a unit
 * test's critical path.
 */
jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: async () => ({ sent: true }),
}))

import {
  describeSignInClient,
  recordDeviceAndMaybeAlert,
} from '../app/api/_lib/security-alerts'
import { GET } from '../app/api/account/devices/route'

const UID = 'user-7'

/** A request's headers, as the sign-in route sees them. */
function headersFor(over: Record<string, string>) {
  const map = new Map(Object.entries(over))
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null }
}

/** Drive the REAL writer for one sign-in. */
async function signIn(input: {
  deviceId: string
  userAgent: string
  city: string
  region: string
  country: string
  ip: string
  atMs: number
}) {
  const client = describeSignInClient(
    headersFor({
      'user-agent': input.userAgent,
      'x-vercel-ip-city': input.city,
      'x-vercel-ip-country-region': input.region,
      'x-vercel-ip-country': input.country,
      'x-forwarded-for': input.ip,
    }),
  )
  return recordDeviceAndMaybeAlert({
    firestore: fakeFirestore,
    uid: UID,
    // No email: recording is the subject, and alerting on the second device
    // would drag the mail path into every case below.
    email: null,
    deviceId: input.deviceId,
    client,
    nowMs: input.atMs,
  })
}

const list = async (token = 'own-token') =>
  (
    await GET(
      new Request('https://console.aglyn.com/api/account/devices', {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
  ).json()

const LAPTOP = {
  deviceId: 'dev-laptop',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  city: 'Dallas',
  region: 'TX',
  country: 'US',
  ip: '203.0.113.4',
  atMs: Date.UTC(2026, 7, 10, 9, 0),
}

const PHONE = {
  deviceId: 'dev-phone',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  city: 'Reykjavik',
  region: 'Capital',
  country: 'IS',
  ip: '198.51.100.9',
  atMs: Date.UTC(2026, 7, 18, 3, 30),
}

beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key]
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: UID, email_verified: true })
})

describe('only the signed-in person reads their own history', () => {
  it('401s without a bearer token', async () => {
    const response = await GET(
      new Request('https://console.aglyn.com/api/account/devices'),
    )
    expect(response.status).toBe(401)
  })

  it('answers for the TOKEN’s uid, never one from the request', async () => {
    await signIn(LAPTOP)
    // The token resolves to somebody else entirely: their (empty) history is
    // what must come back, not this account's.
    mockVerifyIdToken.mockResolvedValue({ uid: 'someone-else' })
    expect((await list()).devices).toEqual([])
  })
})

describe('EACH ROW CARRIES ITS OWN SIGN-IN', () => {
  it('shows both devices with their own browser, city and time', async () => {
    await signIn(LAPTOP)
    await signIn(PHONE)

    const { devices } = await list()
    const byId = Object.fromEntries(
      devices.map((row: any) => [row.id, row]),
    )
    // Two rows that differ in every field. A surface reusing the first row's
    // details satisfies exactly one of these two groups.
    expect(byId['dev-laptop']).toMatchObject({
      location: 'Dallas, TX, US',
      ip: '203.0.113.4',
      lastSeenMs: LAPTOP.atMs,
    })
    expect(byId['dev-phone']).toMatchObject({
      location: 'Reykjavik, Capital, IS',
      ip: '198.51.100.9',
      lastSeenMs: PHONE.atMs,
    })
    // The summarised name is what somebody reads; the raw agent is what they
    // compare when two rows summarise the same.
    expect(byId['dev-laptop'].userAgent).toContain('Macintosh')
    expect(byId['dev-phone'].userAgent).toContain('iPhone')
    expect(byId['dev-laptop'].deviceName).not.toBe(byId['dev-phone'].deviceName)
  })

  it('puts the newest sign-in first', async () => {
    /*
     * The OLDER device is recorded FIRST, so insertion order is the wrong
     * answer and something has to actually sort.
     *
     * Written the other way round to begin with — newer first — and both
     * orderings could then be deleted from the route with this test still
     * green, because insertion order happened to agree. A fixture that agrees
     * with the answer by accident is not a guard, and the row somebody checks
     * after a "new sign-in" email is the top one.
     */
    await signIn(LAPTOP)
    await signIn(PHONE)
    const { devices } = await list()
    expect(devices.map((row: any) => row.id)).toEqual([
      'dev-phone',
      'dev-laptop',
    ])
  })

  it('moves lastSeenAt on a return visit and keeps first-seen where it was', async () => {
    // The distinction the card renders: "first seen" is when this device
    // appeared, "last used" is the row somebody is actually checking.
    await signIn(LAPTOP)
    const returned = Date.UTC(2026, 7, 19, 7, 15)
    await signIn({ ...LAPTOP, atMs: returned, city: 'Austin' })

    const { devices } = await list()
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({
      firstSeenMs: LAPTOP.atMs,
      lastSeenMs: returned,
      // …and the location follows the device, so a moved session shows where
      // it is NOW rather than where it first appeared.
      location: 'Austin, TX, US',
    })
  })

  it('is empty for an account that has never signed in', async () => {
    expect((await list()).devices).toEqual([])
  })
})

describe('the card is mounted where the email sends people', () => {
  it('renders in Manage Account → Security', () => {
    // Asserted as the MOUNT, not the import: `toContain('RecentSignInsCard')`
    // alone survives deleting the JSX, because the import line keeps the name.
    const page = require('node:fs').readFileSync(
      require('node:path').join(
        __dirname,
        '../app/(app)/manage/user/page.tsx',
      ),
      'utf8',
    )
    expect(page).toContain('<RecentSignInsCard />')
  })
})
