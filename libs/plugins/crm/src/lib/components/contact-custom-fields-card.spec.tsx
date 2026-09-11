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
 * THE CUSTOM FIELDS CARD'S SAVE (AGL-2601, AGL-2804).
 *
 * A value lives under the holder's facet, and a facet is the server's to
 * write: Save sends only the keys that changed to `crm/contact-update`, which
 * judges each against its definition and refuses a plan without the CRM
 * suite. Nothing is written client-direct, and a refusal is shown in the
 * route's own words with the draft kept for another try.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ContactCustomFieldsCard } from './contact-custom-fields-card'

/** Every client-direct write the store received — a save must leave this empty. */
let writes: Array<{ path: string; data: Record<string, unknown> }>

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) =>
    void writes.push({ path: ref.path, data }),
}))

const FIRESTORE = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  // The page hands the document over, so the card makes no read of its own.
  useFirestoreDoc: () => ({ data: null, status: 'success', fromCache: false }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('../hooks/use-contact-field-definitions', () => ({
  useContactFieldDefinitions: () => ({
    active: [{ $id: 'f-tier', key: 'tier', label: 'Tier', type: 'text', order: 1 }],
    ready: true,
  }),
}))

/* The control a definition draws has a spec of its own; here it is a text box. */
jest.mock('./crm-custom-field-control', () => ({
  CrmCustomFieldControl: (props: {
    definition: { label: string }
    value: unknown
    onChange: (value: string) => void
  }) => (
    <input
      aria-label={props.definition.label}
      value={String(props.value ?? '')}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}))

let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => ({
  __esModule: true,
  default: () => null,
}))

/** Every post to a CRM route, and the sentence the next one is refused with. */
let posted: Array<{ route: string; payload: Record<string, any> }>
let refusal: string | null
jest.mock('./use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, any>) => {
    posted.push({ route, payload })
    if (refusal) return { response: { ok: false, status: 403 }, payload: { error: refusal } }
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

const contact = {
  email: 'ada@example.test',
  visibleTo: ['host:host-1'],
  facets: {
    'host-1': { sources: {}, interactions: [], custom: { tier: 'gold' } },
  },
}

const renderCard = () =>
  render(
    <ContactCustomFieldsCard
      hostId="host-1"
      org={{} as never}
      contactId="c1"
      contact={contact}
      basePath="/acme/hosts/shop/crm"
    />,
  )

const editTier = (value: string) =>
  fireEvent.change(screen.getByLabelText('Tier'), { target: { value } })

beforeEach(() => {
  writes = []
  notices = []
  posted = []
  refusal = null
})

describe('saving custom values', () => {
  it('sends only the changed keys to crm/contact-update, and writes nothing client-direct', async () => {
    renderCard()
    expect((screen.getByLabelText('Tier') as HTMLInputElement).value).toBe('gold')
    editTier('platinum')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(notices).toContain('Contact saved'))
    expect(posted).toEqual([
      {
        route: 'contact-update',
        payload: { contactIds: ['c1'], set: { custom: { tier: 'platinum' } } },
      },
    ])
    expect(writes).toEqual([])
  })

  it("shows a refusal in the route's own words, and keeps the draft", async () => {
    refusal =
      "Editing a contact's custom fields is part of the CRM suite, which is not " +
      'included in your current plan.'
    renderCard()
    editTier('platinum')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(notices).toContain(refusal))
    expect((screen.getByLabelText('Tier') as HTMLInputElement).value).toBe('platinum')
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
    expect(writes).toEqual([])
  })
})
