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
 * THE CAMPAIGN FILING ON A CONTACT (AGL-2596, AGL-2804).
 *
 * Which campaigns a site has filed a person under lives in that holder's
 * facet, and a facet is the server's to write: Save filing is a post to
 * `crm/contact-update` — on every plan, since filing is not the CRM suite's
 * — and nothing is written client-direct. The stale-seed guard still stands
 * in front of it: a filing saved over an unconfirmed read is refused before
 * any request leaves.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { soloConsentGroup } from '@aglyn/aglyn'
import type { ContactRecord } from '../model/contact-record'
import { ContactAssociationsCard } from './contact-associations-card'

/** Every client-direct write the store received — a save must leave this empty. */
let writes: Array<{ path: string; data: Record<string, unknown> }>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  // No lead is filed for the person, which is a fact the card simply does not draw.
  getDoc: async () => ({ exists: () => false }),
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) =>
    void writes.push({ path: ref.path, data }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useHostCampaigns: () => ({
    options: [{ id: 'spring', label: 'Spring push' }],
    truncated: false,
    ready: true,
  }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('@aglyn/plugins-marketing/components/conversion-attribution.component', () => ({
  __esModule: true,
  default: () => null,
}))
/* The picker has a spec of its own; here it files the person under one campaign. */
jest.mock('@aglyn/shared-ui-email-campaigns/components/campaign-picker.component', () => ({
  __esModule: true,
  default: (props: { onChange: (ids: string[]) => void }) => (
    <button type="button" onClick={() => props.onChange(['spring'])}>
      {'File under Spring push'}
    </button>
  ),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

/** Every post to a CRM route. */
let posted: Array<{ route: string; payload: Record<string, any> }>
jest.mock('./use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, any>) => {
    posted.push({ route, payload })
    return {
      response: { ok: true, status: 200 },
      payload: {
        ok: true,
        results: (payload['contactIds'] ?? []).map((contactId: string) => ({
          contactId,
          ok: true,
        })),
      },
    }
  },
}))

const GROUP = soloConsentGroup('host-1')
const record = {
  $id: 'c1',
  email: 'ada@example.test',
  sources: { form: true },
  campaignIds: [],
} as unknown as ContactRecord

const renderCard = (seed = { status: 'success' as const, fromCache: false }) =>
  render(
    <ContactAssociationsCard
      hostId="host-1"
      record={record}
      row={{ email: 'ada@example.test', visibleTo: ['host:host-1'] }}
      consentGroup={GROUP}
      seed={seed}
      basePath="/acme/hosts/shop/crm"
    />,
  )

beforeEach(() => {
  writes = []
  notices = []
  posted = []
})

describe('saving the filing', () => {
  it('files the person through crm/contact-update, and writes nothing client-direct', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'File under Spring push' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save filing' }))
    await waitFor(() => expect(notices).toContain('Filing saved'))
    expect(posted).toEqual([
      {
        route: 'contact-update',
        payload: { contactIds: ['c1'], set: { campaignIds: ['spring'] } },
      },
    ])
    expect(writes).toEqual([])
  })

  it('sends nothing over a read the server never confirmed', async () => {
    renderCard({ status: 'success', fromCache: true })
    fireEvent.click(screen.getByRole('button', { name: 'File under Spring push' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save filing' }))
    await waitFor(() => expect(notices).toHaveLength(1))
    expect(notices[0]).toMatch(/reload/i)
    expect(posted).toEqual([])
    expect(writes).toEqual([])
  })
})
