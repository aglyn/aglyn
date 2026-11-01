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
 * **Name** and **Related To** (AGL-4123), against the real pickers over a
 * doubled listener: what each field offers, in what order, and what picking
 * one hands back.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'

type Row = Record<string, unknown> & { $id: string }

const mockCollections = new Map<string, Row[]>()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  // The query double below names its collection, and a shut listener nothing.
  useFirestoreCollection: (build: () => string | null) => {
    const name = build()
    return { data: name ? (mockCollections.get(name) ?? []) : undefined, status: 'success' }
  },
  useFirestoreDoc: () => ({ data: undefined }),
  useScopeTokens: () => ({ tokens: [], orgWide: true, loaded: true }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.pop(),
  doc: () => 'doc',
  getDoc: async () => ({ exists: () => false }),
  // `deals where contactId == x` reads as `deals?contactId=x`, a window as `deals`.
  query: (name: string, ...clauses: unknown[]) => {
    const filter = clauses.flat().find((clause) => (clause as { field?: string })?.field) as
      | { field: string; value: unknown }
      | undefined
    return filter ? `${name}?${filter.field}=${String(filter.value)}` : name
  },
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  orderBy: () => undefined,
  limit: () => undefined,
}))
jest.mock('../hooks/use-crm-record-names', () => ({
  ...jest.requireActual('../hooks/use-crm-record-names'),
  useCrmRecordNames: () => (kind: string, id: string) =>
    ({
      'contact:c-1': 'Jordan Lee',
      'contact:c-2': 'Pat Lee',
      'deal:d-1': 'Acme renewal',
      'company:co-1': 'Acme Builders',
    })[`${kind}:${id}`],
}))

import { ActivityLinkFields, type ActivityLinkFieldsProps } from './activity-link-fields'

const scope = {
  dataScope: ['orgs', 'org-1'],
  orgId: 'org-1',
  readTokens: null,
  consentGroup: null,
  org: {},
} as unknown as ActivityLinkFieldsProps['scope']

const fields = (props: Partial<ActivityLinkFieldsProps>) => {
  const onChange = jest.fn()
  render(
    <ActivityLinkFields
      scope={scope}
      picks={{ contactId: null, related: null }}
      onChange={onChange}
      link={{}}
      {...props}
    />,
  )
  return onChange
}

/** Opens a field's menu; answers its groups and options, top to bottom. */
const open = (name: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }))
  return within(screen.getByRole('listbox'))
}

beforeEach(() => {
  mockCollections.clear()
  mockCollections.set('contacts', [
    { $id: 'c-3', email: 'sam@example.com' },
    { $id: 'c-1', email: 'jordan@example.com', name: 'Jordan Lee' },
  ])
  mockCollections.set('companies', [{ $id: 'co-1', name: 'Acme Builders' }])
  mockCollections.set('deals', [
    { $id: 'd-1', title: 'Acme renewal', status: 'open' },
    { $id: 'd-9', title: 'Old order', status: 'won' },
  ])
})

describe('Name', () => {
  it('opens on the contact it was given, named', () => {
    fields({ picks: { contactId: 'c-1', related: null } })
    expect((screen.getByRole('combobox', { name: 'Name' }) as HTMLInputElement).value).toBe('Jordan Lee')
  })

  it('leads with the deal’s contact roles, whichever part they play, and offers everybody else', () => {
    fields({
      deal: {
        contactId: 'c-1',
        contactRoles: [
          { contactId: 'c-1', primary: true },
          { contactId: 'c-2', role: 'Influencer', primary: false },
        ],
      },
    })
    const menu = open('Name')
    expect(menu.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Jordan Lee',
      'Pat Lee',
      'sam@example.com',
    ])
    expect(menu.getByText('On this deal')).toBeTruthy()
  })

  it('hands back the contact picked', () => {
    const onChange = fields({ picks: { contactId: null, related: { kind: 'deal', id: 'd-1' } } })
    fireEvent.click(open('Name').getByRole('option', { name: 'sam@example.com' }))
    expect(onChange).toHaveBeenCalledWith({
      contactId: 'c-3',
      related: { kind: 'deal', id: 'd-1' },
    })
  })
})

describe('Related To', () => {
  it('leads with the contact’s open deals, and leaves their closed ones in the deals list', () => {
    mockCollections.set('deals?contactId=c-1', [
      { $id: 'd-1', title: 'Acme renewal', status: 'open' },
      { $id: 'd-9', title: 'Old order', status: 'won' },
    ])
    fields({ picks: { contactId: 'c-1', related: null } })
    const menu = open('Related To')
    expect(menu.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Acme renewal',
      'Acme Builders',
      'Old order',
    ])
    expect(menu.getByText('Open deals')).toBeTruthy()
    expect(menu.getByText('Companies')).toBeTruthy()
  })

  it('leads with a company’s open deals when opened on the company', () => {
    mockCollections.set('deals?companyId=co-1', [{ $id: 'd-1', title: 'Acme renewal', status: 'open' }])
    fields({ link: { companyId: 'co-1' }, picks: { contactId: null, related: { kind: 'company', id: 'co-1' } } })
    expect(open('Related To').getByText('Open deals')).toBeTruthy()
  })

  it('opens on the record it was given, named, with nothing listening yet', () => {
    fields({ picks: { contactId: null, related: { kind: 'deal', id: 'd-1' } } })
    expect((screen.getByRole('combobox', { name: 'Related To' }) as HTMLInputElement).value).toBe(
      'Acme renewal',
    )
  })

  it('hands back a company or a deal, and nothing when cleared', () => {
    const onChange = fields({ picks: { contactId: 'c-1', related: null } })
    fireEvent.click(open('Related To').getByRole('option', { name: 'Acme Builders' }))
    expect(onChange).toHaveBeenCalledWith({
      contactId: 'c-1',
      related: { kind: 'company', id: 'co-1' },
    })
  })
})

describe('an entry attached to nothing', () => {
  it('says what it needs, and only then', () => {
    fields({})
    expect(screen.getByText('Name a contact, or what this is related to.')).toBeTruthy()
  })

  it('says nothing once either field names a record', () => {
    fields({ picks: { contactId: 'c-1', related: null } })
    expect(screen.queryByText('Name a contact, or what this is related to.')).toBeNull()
  })
})
