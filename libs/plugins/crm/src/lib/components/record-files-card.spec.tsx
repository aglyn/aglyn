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
 * FILES ON A RECORD, AND WHO WRITES THEM (AGL-2662, AGL-2804).
 *
 * A contact's attachments live in the viewing holder's facet, and a facet is
 * the server's to write: attaching or removing a file on a contact is a post
 * to `crm/contact-update`, which refuses a plan without the CRM suite. A
 * company's or a deal's attachments sit at the top of their own document,
 * whose rules already ask the plan (AGL-2801), and stay a client-direct
 * write.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { RecordFilesCard } from './record-files-card'

/** Every client-direct write the store received. */
let writes: Array<{ path: string; data: Record<string, unknown> }>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: async (ref: { path: string }) => ({
    data: () =>
      ref.path.endsWith('/m-1')
        ? { fileName: 'contract.pdf', contentType: 'application/pdf' }
        : { fileName: 'brief.pdf', contentType: 'application/pdf' },
  }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) =>
    void writes.push({ path: ref.path, data }),
}))

// One instance for every render, as the real hook hands back: the card reads
// each attachment from an effect keyed on it.
const FIRESTORE = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
}))

/* The library picker is the console's; here it hands back one more file. */
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useMediaPicker: () => ({ pickMedia: async () => ({ mediaId: 'm-2' }) }),
}))

let notices: string[]
jest.mock('notistack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  MdiIcon: () => null,
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

beforeEach(() => {
  writes = []
  notices = []
  posted = []
})

describe("a contact's files", () => {
  const renderContact = () =>
    render(
      <RecordFilesCard
        scope={['orgs', 'org-1']}
        collection="contacts"
        recordId="c1"
        facetGroupId="host-1"
        hostId="host-1"
        mediaIds={['m-1']}
        topic="contactRecord"
      />,
    )

  it('attach through crm/contact-update, as the whole bounded list', async () => {
    renderContact()
    await screen.findByText('contract.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Attach…' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      route: 'contact-update',
      payload: { contactIds: ['c1'], set: { mediaIds: ['m-1', 'm-2'] } },
    })
    expect(writes).toEqual([])
  })

  it('are removed through the route too', async () => {
    renderContact()
    await screen.findByText('contract.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Remove contract.pdf' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].payload).toEqual({ contactIds: ['c1'], set: { mediaIds: [] } })
    expect(writes).toEqual([])
  })
})

describe("a company's files", () => {
  it('stay a client-direct write at the top of the company, whose rules ask the plan', async () => {
    render(
      <RecordFilesCard
        scope={['orgs', 'org-1']}
        collection="companies"
        recordId="co-1"
        mediaIds={['m-1']}
        topic="companies"
      />,
    )
    await screen.findByText('contract.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Attach…' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({
      path: 'orgs/org-1/companies/co-1',
      data: { mediaIds: ['m-1', 'm-2'], updatedAt: { op: 'serverTimestamp' } },
    })
    expect(posted).toEqual([])
  })
})
