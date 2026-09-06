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
 * A SUBMISSION NAMED IN THE URL OPENS IN THE READER (AGL-2622).
 *
 * A contact's timeline links to the submission that captured the person as
 * `…/inbox/submissions?submission={id}`. The card reads that one document
 * by id — the paged window may not reach a months-old submission — opens
 * the reader on it and marks it read, as a click would. A submission that
 * is gone is said to be gone: a reader that silently stays shut reads as
 * the link having done nothing.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { getDoc, updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import SubmissionsCard from './submissions-card.component'

let search = ''
let stored: Record<string, unknown> | null = null
const enqueueSnackbar = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  usePagedCollection: () => ({
    rows: [],
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  limit: () => undefined,
  orderBy: () => undefined,
  where: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn(async () => ({
    id: 'sub-9',
    exists: () => stored !== null,
    data: () => stored ?? undefined,
  })),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <div>
      <h2>{header}</h2>
      {children}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('@aglyn/plugins-marketing/components/conversion-attribution.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./submission-reply.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./submission-list-assignment.component', () => ({
  __esModule: true,
  default: () => null,
}))

beforeEach(() => {
  jest.clearAllMocks()
  search = ''
  stored = null
})

describe('?submission= on the Inbox', () => {
  it('reads the named submission once, opens the reader on it and marks it read', async () => {
    search = 'submission=sub-9'
    stored = {
      formName: 'Quote request',
      fields: { name: 'Priya Nair', email: 'priya@example.test' },
      read: false,
    }
    render(<SubmissionsCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Quote request')).toBeTruthy())
    expect(getDoc).toHaveBeenCalledTimes(1)
    expect((getDoc as jest.Mock).mock.calls[0][0]).toBe(
      'hosts/host-1/formSubmissions/sub-9',
    )
    expect(updateDoc).toHaveBeenCalledWith('hosts/host-1/formSubmissions/sub-9', {
      read: true,
    })
  })

  it('says so when the named submission is gone, and opens nothing', async () => {
    search = 'submission=sub-9'
    stored = null
    render(<SubmissionsCard hostId="host-1" />)
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(enqueueSnackbar.mock.calls[0][0]).toMatch(/no longer in the Inbox/)
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('reads nothing when the URL names no submission', () => {
    render(<SubmissionsCard hostId="host-1" />)
    expect(getDoc).not.toHaveBeenCalled()
  })
})
