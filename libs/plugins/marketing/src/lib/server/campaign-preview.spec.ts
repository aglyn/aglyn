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
 * AGL-2178 — `Recipients 1,240`, the readout the campaign composer mockup
 * puts beside the audience picker.
 *
 * The console produced that number only AFTER a send, in a snackbar. The
 * fix is a dry run of the real send path rather than a counting function
 * of its own, and the whole argument for that is here: the figure has to
 * agree with what goes out, through de-duplication, the per-send cap, the
 * suppression list and the monthly quota.
 *
 * The second claim is that a dry run WRITES NOTHING. It returns before the
 * first write, so a merchant clicking through audiences must not leave a
 * trail of campaign documents or a moved counter behind them.
 */

const mockState: {
  store: Record<string, Record<string, unknown>>
  sent: Array<Record<string, any>>
} = { store: {}, sent: [] }

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
    },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
  meterHostEmail: async () => undefined,
  /*
   * AGL-2267/AGL-2409. The barrel factory is a CLOSED WORLD — anything the
   * sender imports and this object omits arrives as `undefined` and throws at
   * the call — so the org-scoped cap and the platform send-rate governor have
   * to be listed here even where neither is what the file is testing.
   *
   * Permissive on purpose: this file is about something else, and a cap or a
   * ceiling that refused here would make every assertion below a test of the
   * cap. `campaign-send.spec.ts` owns the enforcement.
   */
  orgCampaignEmailSendsForMonth: async () => 0,
  reserveCampaignEmailSends: async ({ count }: any) => ({
    ok: true,
    reservation: { orgId: 'org-1', month: '2026-08', reserved: count },
    used: 0,
    limit: 500,
  }),
  reconcileCampaignSendReservation: async () => undefined,
  readEmailSendRateConfig: async () => ({
    perHour: 100_000,
    enabled: true,
    updatedAtMs: null,
    updatedByEmail: null,
    note: '',
  }),
  readEmailSendRateWindow: async () => ({
    windowStartMs: 0,
    resetMs: 3_600_000,
    used: 0,
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockState.sent.push(message)
    return { sent: true }
  },
}))

import { CampaignSendError, performCampaignSend } from './campaign-send'
import { suppressionId } from './campaign-send'

function mockFirestore(): any {
  const store = mockState.store
  const snapshot = (path: string) => {
    const data = store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, unknown>) => {
      store[path] = { ...(store[path] ?? {}), ...value }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    limit: () => ({
      get: async () => ({
        docs: Object.keys(store)
          .filter(
            (key) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes('/'),
          )
          .map(snapshot),
      }),
    }),
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
  })
  return { collection: (name: string) => collectionRef(name) }
}

/** A site with `count` leads, plus whatever else the case needs. */
const seed = (count: number, extra: Record<string, Record<string, unknown>> = {}) => {
  mockState.store = {
    'hosts/host-1': { subdomain: 'acme', memberRoles: {} },
    ...Object.fromEntries(
      Array.from({ length: count }, (_item, index) => [
        `hosts/host-1/leads/lead-${index}`,
        { email: `lead${index}@example.com`, name: `Lead ${index}` },
      ]),
    ),
    ...extra,
  }
  mockState.sent = []
}

const preview = () =>
  performCampaignSend({
    hostId: 'host-1',
    subject: 'Spring sale',
    body: 'plain text',
    audience: 'leads',
    senderUid: 'uid-1',
    dryRun: true,
  })

let previousSecret: string | undefined
beforeAll(() => {
  previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
})
afterAll(() => {
  if (previousSecret === undefined) {
    delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
  } else {
    process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
  }
})

describe('a campaign recipient preview', () => {
  it('counts the audience and sends nothing', async () => {
    seed(3)
    const result = await preview()
    expect(result.recipients).toBe(3)
    expect(result.sendable).toBe(3)
    expect(result.dryRun).toBe(true)
    expect(mockState.sent).toEqual([])
  })

  it('WRITES nothing — no campaign document, no counter', async () => {
    // A merchant clicking through audiences must not leave a trail. The
    // early return is before the first write, and this is what proves it.
    seed(2)
    const before = Object.keys(mockState.store).sort()
    await preview()
    expect(Object.keys(mockState.store).sort()).toEqual(before)
  })

  it('mints no campaign id', async () => {
    // `campaignId` is the value that comes back on every Resend tag days
    // later (AGL-1768); a preview that minted one would put an id into
    // circulation for a campaign that never existed.
    seed(2)
    expect((await preview()).campaignId).toBe('')
  })

  it('excludes unsubscribed addresses, and says how many', async () => {
    // The one number a merchant checks before pressing Send. Counting the
    // audience without the suppression list would over-report every list
    // that has ever been mailed.
    seed(3, {
      [`hosts/host-1/suppressions/${suppressionId('lead1@example.com')}`]: {
        email: 'lead1@example.com',
      },
    })
    const result = await preview()
    expect(result.recipients).toBe(3)
    expect(result.sendable).toBe(2)
    expect(result.suppressed).toBe(1)
  })

  it('de-duplicates the way the send does', async () => {
    seed(0, {
      'hosts/host-1/leads/a': { email: 'dana@example.com' },
      'hosts/host-1/leads/b': { email: 'DANA@example.com' },
      'hosts/host-1/leads/c': { email: 'not-an-email' },
    })
    const result = await preview()
    // Case-folded to one, and the junk address dropped — exactly what
    // would have gone out.
    expect(result.recipients).toBe(1)
  })

  it('reports an empty audience as the refusal it would be', async () => {
    // Better before the email is written than after the Send button.
    seed(0)
    await expect(preview()).rejects.toBeInstanceOf(CampaignSendError)
  })

  it('surfaces the monthly cap before the email is written', async () => {
    // Starter's emailSendsPerMonth is finite; a month already at the cap
    // refuses, and the composer shows that message under the picker.
    seed(2)
    // `jest.requireMock`, not a deferred `require('@aglyn/tenant-data-admin')`.
    // A literal first-party specifier passed to `require` inside a callback
    // registers a DYNAMIC nx graph edge on plugins-marketing, and nx then
    // forbids every STATIC import of that library in every project that
    // reaches it — hundreds of errors in another app, on files that did not
    // change (AGL-2313). `requireMock` reads jest's mock registry rather than
    // loading a module, so nx records nothing and the spy still lands on the
    // very object the factory above returned. A namespace import would NOT:
    // the interop wrapper copies the properties, and the copy is not what
    // `campaign-send` calls.
    //
    // Since AGL-2267 the figure is ORG-scoped and read through
    // `orgCampaignEmailSendsForMonth`; the per-SITE reader this used to spy on
    // is no longer what the cap asks. The property name is the whole point of
    // the test — a preview must refuse on the same reading the send does.
    const withUsage = jest
      .spyOn(
        jest.requireMock('@aglyn/tenant-data-admin') as {
          orgCampaignEmailSendsForMonth: (...args: any[]) => Promise<number>
        },
        'orgCampaignEmailSendsForMonth',
      )
      .mockResolvedValue(1_000_000)
    await expect(preview()).rejects.toBeInstanceOf(CampaignSendError)
    // AGL-2267: and it must ask about the ORG. The dry run is the ONLY
    // consumer of this read — the real send is enforced by the atomic
    // reservation — so a preview that asked about the site would quote a
    // merchant a headroom figure the send then disagrees with, and nothing
    // else in the tree would notice.
    expect(withUsage).toHaveBeenCalledWith('org-1', expect.any(String))
    withUsage.mockRestore()
  })
})
