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
  campaignEmailSendsForMonth: async () => 0,
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
    const withUsage = jest
      .spyOn(
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('@aglyn/tenant-data-admin'),
        'campaignEmailSendsForMonth',
      )
      .mockResolvedValue(1_000_000)
    await expect(preview()).rejects.toBeInstanceOf(CampaignSendError)
    withUsage.mockRestore()
  })
})
