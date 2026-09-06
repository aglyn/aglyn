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

import { soloConsentGroup } from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { ContactMergeDialog, type ContactPick } from './contact-merge-dialog'

/**
 * The merge dialog (AGL-2625): the other record found on ask, the two shown
 * side by side through the viewing group's facet with the value that lands,
 * the survivor chosen by the reader, and one post to the route with the ids
 * the right way round.
 */

let searchDocs: Array<{ id: string; data: () => Record<string, unknown> }>
let searchQueries: unknown[][]
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (...parts: unknown[]) => parts,
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: string) => ({ orderBy: field }),
  startAt: (value: unknown) => ({ startAt: value }),
  endAt: (value: unknown) => ({ endAt: value }),
  limit: (value: number) => ({ limit: value }),
  getDocs: async (parts: unknown[]) => {
    searchQueries.push(parts)
    return { docs: searchDocs }
  },
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-me', getIdToken: async () => 'token-abc' } }),
}))
let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
}))

let calls: Array<{ url: string; body: Record<string, unknown>; token: string | undefined }>
let answer: { ok: boolean; payload: Record<string, unknown> }

const GROUP = soloConsentGroup('host-1')
const current: ContactPick = {
  id: 'c-keep',
  doc: {
    email: 'jane@acme.com',
    name: 'Jane Doe',
    facets: {
      'host-1': { sources: {}, interactions: [], phone: '+15125550100', lifecycleStage: 'lead' },
    },
  },
}
const other: ContactPick = {
  id: 'c-gone',
  doc: {
    email: 'jane@gmail.com',
    name: 'J Doe',
    facets: {
      'host-1': { sources: {}, interactions: [], jobTitle: 'Buyer', ownerUid: 'u-2' },
      'other-holder': { sources: {}, interactions: [], phone: '+10000000000' },
    },
  },
}

beforeEach(() => {
  searchDocs = []
  searchQueries = []
  notices = []
  calls = []
  answer = { ok: true, payload: { ok: true, survivorId: 'c-keep' } }
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({
      url: String(url),
      body: JSON.parse(init.body),
      token: init?.headers?.Authorization,
    })
    return { ok: answer.ok, json: async () => answer.payload } as any
  })
})

const mount = (extra: Record<string, unknown> = {}) => {
  const onClose = jest.fn()
  const onMerged = jest.fn()
  render(
    <ContactMergeDialog
      open
      other={null}
      keep="other"
      onClose={onClose}
      onMerged={onMerged}
      hostId="host-1"
      current={current}
      scope={['orgs', 'org-1']}
      consentGroup={GROUP}
      visibleTo={['org', 'host:host-1']}
      memberName={(uid) => (uid === 'u-2' ? 'Grace' : uid)}
      {...extra}
    />,
  )
  return { onClose, onMerged }
}

/** A preview row's four cells — the label header and the three values. */
const cell = (label: string) => {
  const row = screen.getByRole('row', { name: new RegExp(`^${label}`) })
  return [...row.querySelectorAll('th,td')].map((element) => element.textContent)
}

describe('finding the other record', () => {
  it('searches by address when the term has one, scoped to what the viewer may list', async () => {
    searchDocs = [{ id: 'c-gone', data: () => other.doc }]
    mount()
    fireEvent.change(screen.getByLabelText('Email or name'), {
      target: { value: ' Jane@Gmail.com ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(searchQueries).toHaveLength(1))
    expect(searchQueries[0]).toEqual(
      expect.arrayContaining([
        { where: ['visibleTo', 'array-contains-any', ['org', 'host:host-1']] },
        { where: ['email', '==', 'jane@gmail.com'] },
      ]),
    )
    expect(await screen.findByText('J Doe')).toBeTruthy()
  })

  it('searches by name prefix otherwise, and never offers the record itself', async () => {
    searchDocs = [
      { id: 'c-keep', data: () => current.doc },
      { id: 'c-gone', data: () => other.doc },
    ]
    mount()
    fireEvent.change(screen.getByLabelText('Email or name'), { target: { value: 'Jane' } })
    fireEvent.keyDown(screen.getByLabelText('Email or name'), { key: 'Enter' })
    await waitFor(() => expect(searchQueries).toHaveLength(1))
    expect(searchQueries[0]).toEqual(
      expect.arrayContaining([{ orderBy: 'nameLower' }, { startAt: 'jane' }]),
    )
    const list = await screen.findByRole('list', { name: 'Matching contacts' })
    expect(within(list).getAllByRole('button')).toHaveLength(1)
    expect(within(list).getByText('J Doe')).toBeTruthy()
  })

  it('offers no merge until the other record is picked', () => {
    mount()
    expect(
      (screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('the preview', () => {
  it('shows each field through the viewing group, with the value that lands', () => {
    mount({ other, keep: 'current' })
    expect(cell('Phone')).toEqual(['Phone', '+15125550100', '', '+15125550100'])
    expect(cell('Job title')).toEqual(['Job title', '', 'Buyer', 'Buyer'])
    expect(cell('Owner')).toEqual(['Owner', '', 'Grace', 'Grace'])
    expect(cell('Email')).toEqual([
      'Email',
      'jane@acme.com',
      'jane@gmail.com',
      'jane@acme.com, jane@gmail.com',
    ])
  })

  it('swaps the columns when the reader keeps the other record', () => {
    mount({ other, keep: 'current' })
    fireEvent.click(screen.getByRole('radio', { name: /J Doe/ }))
    expect(cell('Email')).toEqual([
      'Email',
      'jane@gmail.com',
      'jane@acme.com',
      'jane@gmail.com, jane@acme.com',
    ])
    expect(cell('Phone')).toEqual(['Phone', '', '+15125550100', '+15125550100'])
  })
})

describe('merging', () => {
  it('posts the survivor and the merged record to the route, and reports who survived', async () => {
    const { onClose, onMerged } = mount({ other, keep: 'current' })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({
      url: '/api/crm/contacts-merge',
      body: { hostId: 'host-1', survivorId: 'c-keep', mergedId: 'c-gone' },
      token: 'Bearer token-abc',
    })
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith('c-keep'))
    expect(onClose).toHaveBeenCalled()
    expect(notices).toEqual(['Contacts merged'])
  })

  it('sends the ids the other way round when the other record is kept', async () => {
    const { onMerged } = mount({ other, keep: 'other' })
    answer = { ok: true, payload: { ok: true, survivorId: 'c-gone' } }
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({ hostId: 'host-1', survivorId: 'c-gone', mergedId: 'c-keep' })
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith('c-gone'))
  })

  it("shows the route's own refusal and keeps the dialog open", async () => {
    answer = {
      ok: false,
      payload: { error: 'Merging contacts requires the data permission across the whole workspace' },
    }
    const { onClose, onMerged } = mount({ other, keep: 'current' })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(
      await screen.findByText(
        'Merging contacts requires the data permission across the whole workspace',
      ),
    ).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(onMerged).not.toHaveBeenCalled()
  })
})

/**
 * A record no site captured (AGL-2634): beneath the org hub's mount the
 * route's org variant merges it, so the dialog offers Merge and names the
 * org; on a surface mounted nowhere it holds the button and says why.
 */
describe('a record no site captured', () => {
  const renderWithoutSite = (mounted: boolean) => {
    const dialog = (
      <ContactMergeDialog
        open
        other={other}
        keep="current"
        onClose={jest.fn()}
        hostId={null}
        current={current}
        scope={['orgs', 'org-1']}
        consentGroup={GROUP}
        visibleTo={null}
      />
    )
    return render(
      mounted ? (
        <CrmOrgMountProvider
          mount={{
            orgId: 'org-1',
            hosts: [{ id: 'host-1', name: 'Site 1', subdomain: 'one' }],
            hostsReady: true,
            hostsPath: '/acme/hosts',
          }}
        >
          {dialog}
        </CrmOrgMountProvider>
      ) : (
        dialog
      ),
    )
  }

  it('merges through the org variant beneath the mount', async () => {
    renderWithoutSite(true)
    expect(screen.queryByText(/No site has captured this contact/)).toBeNull()
    const button = screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toEqual({
      hostId: null,
      orgId: 'org-1',
      survivorId: 'c-keep',
      mergedId: 'c-gone',
    })
  })

  it('holds the button on a surface mounted nowhere, and says why', () => {
    renderWithoutSite(false)
    expect(screen.getByText(/No site has captured this contact/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls).toEqual([])
  })
})
