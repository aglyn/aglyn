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
 * A dataset created from a site's Data page names that site (AGL-2891).
 *
 * The org setting "New datasets and files are shared with" offers All sites
 * or Only the site they were created in, and `/api/orgs/datasets` has always
 * applied it through `defaultScopeForNewResource` — but that helper can only
 * narrow to a site the REQUEST names, and this card never named one. Every
 * dataset made on a site's Data page therefore landed on All sites, whatever
 * the organization had chosen.
 *
 * Contracts:
 *
 *  1. BOTH CREATES NAME THE SITE. The plain create and the join collection
 *     are two handlers over one helper, and a join collection is a dataset.
 *  2. THE ORG DATA PAGE NAMES NONE. It has no site, so its creates stay on
 *     All sites, as the setting's own helper text says.
 *  3. AN EXPLICIT ORG WINS. `orgId` is the org Data page's scope and already
 *     wins over `hostId` for resolving the org; a card handed both must not
 *     send a site that page is not in.
 *  4. THE CAPTION MATCHES. The card used to say a new dataset is shared with
 *     every site, which stops being true on a site page once the org chose
 *     otherwise.
 *
 * NO PRODUCTION DATA IS READ; every Firestore and HTTP call is a local stub.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type { ReactNode } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'

const ATTENDEES = {
  $id: 'ds-attendees',
  displayName: 'Attendees',
  model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } },
  visibleTo: ['org'],
}
const EVENTS = {
  $id: 'ds-events',
  displayName: 'Events',
  model: { order: ['title'], fields: { title: { name: 'Title', type: 'text' } } },
  visibleTo: ['org'],
}

/**
 * STABLE, like the real listener: `datasets` feeds the reference-picker
 * effect, and a fresh array per render re-runs it into an update loop that
 * would belong to the stub.
 */
const datasetDocs = [ATTENDEES, EVENTS]

/** Stable for the same reason — see `host-datasets-card-head-count.spec`. */
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }
const FIRESTORE = {}
const USER = { uid: 'uid-test' }

/** Stock `scale`: datasets included and far more of them than two. */
const ORG = { $id: 'org-1', plan: 'scale' }

/** What the org Data page's lookup would answer — every mount is org-1's. */
const useOrgDataScopeSpy = jest.fn((_options: unknown) => DATA_SCOPE)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: (options: unknown) => useOrgDataScopeSpy(options),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useUser: () => ({ data: USER }),
  useHostActivityLogger: () => jest.fn(),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    return {
      data: String(built?.path ?? '').endsWith('/datasets') ? datasetDocs : [],
      status: 'success',
      fromCache: false,
    }
  },
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
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => undefined,
  getCountFromServer: async () => ({ data: () => ({ count: 2 }) }),
  getDocs: async () => ({ docs: [] }),
  deleteDoc: jest.fn(async () => undefined),
  setDoc: jest.fn(async () => undefined),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
}))

/** Every request the card sends to the console API, body parsed. */
const sent: Array<{ url: string; body: Record<string, unknown> }> = []
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (
    _user: unknown,
    url: string,
    init?: { body?: string },
  ) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
    return {
      ok: true,
      json: async () => ({ ok: true, id: `ds-new-${sent.length}` }),
    }
  },
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  sent.length = 0
})

/** Mounted and settled: the two count aggregates resolve off the mount. */
const mountCard = async (props: Record<string, unknown>) => {
  render(<HostDatasetsCard org={ORG as any} {...props} />)
  await act(async () => {
    await Promise.resolve()
  })
}

/** The `create-dataset` bodies the card posted, in order. */
const creates = () =>
  sent
    .filter(
      (request) =>
        request.url === '/api/orgs/datasets' &&
        request.body['action'] === 'create-dataset',
    )
    .map((request) => request.body)

const createDataset = async () => {
  fireEvent.click(screen.getByText('Add dataset'))
  const dialog = within(await screen.findByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Name'), {
    target: { value: 'Speakers' },
  })
  fireEvent.change(dialog.getByLabelText('Fields'), {
    target: { value: 'Name, Talk title' },
  })
  fireEvent.click(dialog.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(creates()).toHaveLength(1))
}

const pick = (label: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

const createJoinCollection = async () => {
  fireEvent.click(screen.getByText('Add join collection'))
  await screen.findByRole('dialog')
  pick('First collection', 'Attendees')
  pick('Second collection', 'Events')
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.click(dialog.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(creates()).toHaveLength(1))
}

describe("a site's Data page names its site on every create (AGL-2891)", () => {
  it('sends the site with a new dataset', async () => {
    await mountCard({ hostId: 'host-a' })
    await createDataset()

    // The org still rides every request; the site is what was missing. Red
    // before the fix: the body carried orgId, action, displayName, fields
    // and model, and the route stamped All sites for want of a site.
    expect(creates()[0]).toMatchObject({
      orgId: 'org-1',
      action: 'create-dataset',
      displayName: 'Speakers',
      hostId: 'host-a',
    })
  })

  it('sends the site with a join collection', async () => {
    await mountCard({ hostId: 'host-a' })
    await createJoinCollection()

    // A join collection is a dataset and takes the same Default sharing.
    // Asserted separately because it is a separate handler: fixing the loud
    // create and not this one would leave half the setting unapplied.
    expect(creates()[0]).toMatchObject({
      orgId: 'org-1',
      action: 'create-dataset',
      displayName: 'Attendees ↔ Events',
      hostId: 'host-a',
    })
  })
})

describe('the organization Data page names no site', () => {
  it('sends no site with a new dataset', async () => {
    await mountCard({ orgId: 'org-1' })
    await createDataset()

    // Absent, not empty or null: there is no site, and the route treats a
    // missing one as the org Data page.
    expect(creates()[0]).toMatchObject({ orgId: 'org-1', displayName: 'Speakers' })
    expect(creates()[0]).not.toHaveProperty('hostId')
  })

  it('sends no site with a join collection', async () => {
    await mountCard({ orgId: 'org-1' })
    await createJoinCollection()

    expect(creates()[0]).toMatchObject({ orgId: 'org-1' })
    expect(creates()[0]).not.toHaveProperty('hostId')
  })

  it('lets an explicit org win over a site handed in beside it', async () => {
    // The org scope already wins over `hostId` when the org is resolved — the
    // lookup below is asked with both — so a stale site id beside it must not
    // reach the create either.
    await mountCard({ orgId: 'org-1', hostId: 'host-stale' })
    expect(useOrgDataScopeSpy).toHaveBeenCalledWith({
      hostId: 'host-stale',
      orgId: 'org-1',
    })

    await createDataset()
    expect(creates()[0]).not.toHaveProperty('hostId')
  })
})

describe('the caption says what a new dataset starts on', () => {
  const SITE_ONLY = /this site only/
  const EVERY_SITE = /A new one is shared with every site/

  it('on a site page of an org that chose its own site', async () => {
    await mountCard({
      hostId: 'host-a',
      org: { ...ORG, defaultResourceScope: 'host' },
    })
    expect(screen.getByText(SITE_ONLY)).toBeTruthy()
    expect(screen.queryByText(EVERY_SITE)).toBeNull()
  })

  it('on a site page of an org that shares with every site', async () => {
    await mountCard({
      hostId: 'host-a',
      org: { ...ORG, defaultResourceScope: 'org' },
    })
    expect(screen.getByText(EVERY_SITE)).toBeTruthy()
    expect(screen.queryByText(SITE_ONLY)).toBeNull()
  })

  it('on the org Data page, whatever the org chose', async () => {
    // No site to limit it to, so the setting cannot narrow a create here.
    await mountCard({
      orgId: 'org-1',
      org: { ...ORG, defaultResourceScope: 'host' },
    })
    expect(screen.getByText(EVERY_SITE)).toBeTruthy()
    expect(screen.queryByText(SITE_ONLY)).toBeNull()
  })
})
