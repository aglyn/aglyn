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
 * FILLING A FIXED LIST FROM A SEARCH, through the gate the typed path uses.
 *
 * A fixed list could only gain a member by somebody typing or pasting an
 * address, which is the complaint behind this work. The fix is a search — and
 * a search that ended in its own add path would be a fifth bulk sender: the
 * register already carries four that reached inboxes with no suppression check
 * and no cap.
 *
 * So the property under test is not "the button adds people". It is that the
 * button reaches the SAME consent readout, the SAME attestation, and the SAME
 * add route as typing an address by hand — that finding people replaces the
 * typing and nothing else.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { soloConsentGroup } from '@aglyn/aglyn'
import { ListMembersPanel } from './list-members-panel'

const FIRESTORE = {}
const NO_MEMBERS = {
  rows: [],
  hasMore: false,
  page: 0,
  setPage: () => undefined,
  pageSize: 10,
  setPageSize: () => undefined,
  status: 'success',
  fromCache: false,
}

/** How the signed-in account answers `getIdToken()` for the test at hand. */
let mockTokenBehavior: 'mints' | 'signed-out' = 'mints'
const mockGetIdToken = jest.fn(async () => 'token-abc')

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  // An account that can mint a token. Without one every request this panel
  // makes is refused before it is issued — which is the point: the panel
  // reaches routes that answer 401 without a bearer token.
  useUser: () => ({
    data:
      mockTokenBehavior === 'signed-out'
        ? { uid: 'uid-test' }
        : { uid: 'uid-test', getIdToken: mockGetIdToken },
  }),
  usePagedCollection: () => NO_MEMBERS,
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  query: (base: any) => base,
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

/** Everything the panel put in front of the organizer. */
const mockNotices: string[] = []
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => {
      mockNotices.push(String(message))
    },
  }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

const OPTED_IN = 'priya@lumen.co'
const NO_BASIS = 'dev@lumen.co'
const SUPPRESSED = 'sam@lumen.co'

const RULE = { sources: ['contacts' as const], tags: ['vip'] }

/** What the routes answer, per test. */
let rulePreview: Record<string, unknown>
let addAnswer: Record<string, unknown>
/** Every request the panel made, as `[route, body]`. */
let calls: Array<[string, any]>
/** The `Authorization` header each of those requests carried, in order. */
let auth: Array<string | undefined>

const fetchMock = jest.fn(async (url: string, init: any) => {
  const route = String(url).replace('/api/email/', '')
  const body = JSON.parse(init.body)
  calls.push([route, body])
  auth.push(init?.headers?.Authorization)
  const payload = route === 'list-rule-preview' ? rulePreview : addAnswer
  return { ok: true, json: async () => payload } as any
})

beforeEach(() => {
  calls = []
  auth = []
  mockTokenBehavior = 'mints'
  mockNotices.length = 0
  mockGetIdToken.mockClear()
  fetchMock.mockClear()
  ;(globalThis as any).fetch = fetchMock
  rulePreview = {
    matched: 2,
    truncated: false,
    complete: true,
    empty: false,
    emails: [OPTED_IN, NO_BASIS],
    verdicts: [
      {
        input: OPTED_IN,
        email: OPTED_IN,
        refusal: null,
        requiresAttestation: false,
        summary: 'Opted in',
      },
      {
        input: NO_BASIS,
        email: NO_BASIS,
        refusal: null,
        requiresAttestation: true,
        summary: 'No opt-in on record',
      },
    ],
    optedIn: 1,
    needAttestation: 1,
    refused: 0,
  }
  addAnswer = { added: 2, results: [] }
})

const mount = async (props: Record<string, unknown> = {}) => {
  render(
    <ListMembersPanel
      hostId="host-1"
      consentGroup={soloConsentGroup('host-1')}
      scope={['orgs', 'org-1']}
      listId="list-1"
      listName="Newsletter"
      findRule={RULE as never}
      ruleSummary={['Draws from contacts.', 'Tagged any of: vip.']}
      {...props}
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const find = async () => {
  fireEvent.click(screen.getByText('Find matching people'))
  await waitFor(() =>
    expect(calls.some(([route]) => route === 'list-rule-preview')).toBe(true),
  )
}

describe('a fixed list can be filled from a search', () => {
  it('THE CONTROL: the search control is offered, and it asks the route', async () => {
    // Anti-vacuity. Several assertions below are of the form "the add was not
    // sent", which a panel with no search button at all would satisfy.
    await mount()
    expect(screen.getByText('Draws from contacts.')).toBeTruthy()
    await find()
    expect(calls[0][0]).toBe('list-rule-preview')
    expect(calls[0][1]).toMatchObject({
      hostId: 'host-1',
      listId: 'list-1',
      rule: RULE,
    })
  })

  it('issues nothing when the account cannot be authorized', async () => {
    /*
     * The half a positive control cannot cover. Assembled as
     * `...(idToken ? { Authorization } : {})`, a signed-out organizer still
     * searched — anonymously — and read the route's 401 as "nobody
     * matched", which is the same sentence an empty audience produces.
     */
    mockTokenBehavior = 'signed-out'
    await mount()
    // Clicked directly rather than through `find()`, which waits for the
    // request this case must never make.
    fireEvent.click(screen.getByText('Find matching people'))
    await waitFor(() => expect(mockNotices.length).toBeGreaterThan(0))
    expect(calls).toHaveLength(0)
    expect(mockNotices.join(' | ')).toMatch(/signed out/i)
  })

  it('every request carries the token this account minted', async () => {
    /*
     * These routes answer 401 without a bearer token. Assembled as
     * `...(idToken ? { Authorization } : {})`, an organizer whose token
     * could not be minted searched their own contacts anonymously and read
     * the refusal as "nobody matched".
     */
    await mount()
    await find()
    expect(auth.length).toBeGreaterThan(0)
    expect(auth.every((one) => one === 'Bearer token-abc')).toBe(true)
  })

  it('is not offered at all on a list without saved filters', async () => {
    // A live list's membership is the sweep's to decide, and hand-adding its
    // own matches would write manual copies of rows the sweep owns.
    await mount({ findRule: null })
    expect(screen.queryByText('Find matching people')).toBeNull()
  })

  it('reports the whole match, not the size of one batch', async () => {
    rulePreview = { ...rulePreview, matched: 412, truncated: true }
    await mount()
    await find()
    expect(document.body.textContent).toContain('412 people match')
    expect(document.body.textContent).toContain('first 2')
  })

  it('says when the scan itself was cut short', async () => {
    rulePreview = { ...rulePreview, complete: false }
    await mount()
    await find()
    expect(document.body.textContent).toContain('read budget')
  })
})

describe('the search meets the consent gate, not a lighter one', () => {
  it('shows the same readout the typed path shows', async () => {
    await mount()
    await find()
    expect(document.body.textContent).toContain('1 already opted in')
    expect(document.body.textContent).toContain('1 with no opt-in on record')
  })

  it('refuses to add until the attestation is given', async () => {
    await mount()
    await find()
    const button = screen.getByText('Add 2').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(
      (screen.getByText('Add 2').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('sends the found addresses to the ADD route, with the attestation', async () => {
    await mount()
    await find()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Add 2'))
    await waitFor(() =>
      expect(calls.some(([route]) => route === 'list-members-add')).toBe(true),
    )
    const [, body] = calls.find(([route]) => route === 'list-members-add') as [
      string,
      any,
    ]
    expect(body.emails).toEqual([OPTED_IN, NO_BASIS])
    expect(body.attestConsent).toBe(true)
    // The list is named on the request, so the server resolves the same
    // context it gates the typed path with.
    expect(body.listId).toBe('list-1')
  })

  it('a SUPPRESSED match is not among the people offered', async () => {
    /*
     * The defect this whole flow is one careless step from: a bulk path that
     * hands the server every address the filters found, suppressed ones
     * included. The count on the button is the ENROLLABLE count, and the
     * refusal is named on screen.
     */
    rulePreview = {
      ...rulePreview,
      matched: 3,
      emails: [OPTED_IN, NO_BASIS, SUPPRESSED],
      verdicts: [
        ...(rulePreview['verdicts'] as unknown[]),
        {
          input: SUPPRESSED,
          email: SUPPRESSED,
          refusal: 'suppressed-host',
          requiresAttestation: false,
          summary: 'This address is on your suppression list.',
        },
      ],
      refused: 1,
    }
    await mount()
    await find()
    expect(document.body.textContent).toContain('1 cannot be added at all')
    expect(document.body.textContent).toContain('suppression list')
    // Two enrollable of three matched — the refused one is not in the number
    // the operator is about to stand behind.
    expect(screen.getByText('Add 2')).toBeTruthy()
  })

  it('does not offer an add at all when everyone found is refused', async () => {
    rulePreview = {
      ...rulePreview,
      emails: [SUPPRESSED],
      verdicts: [
        {
          input: SUPPRESSED,
          email: SUPPRESSED,
          refusal: 'suppressed-host',
          requiresAttestation: false,
          summary: 'This address is on your suppression list.',
        },
      ],
      optedIn: 0,
      needAttestation: 0,
      refused: 1,
      matched: 1,
    }
    await mount()
    await find()
    const button = screen.getByText('Add 0').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(calls.some(([route]) => route === 'list-members-add')).toBe(false)
  })

  it('typing an address abandons the search', async () => {
    // The two are alternative ways of naming ONE candidate set. Holding both
    // would leave the Add button acting on whichever the code preferred, and
    // the operator attesting for a set they are not looking at.
    await mount()
    await find()
    fireEvent.change(screen.getByLabelText('Email addresses'), {
      target: { value: 'someone@else.co' },
    })
    expect(screen.queryByText('Add 2')).toBeNull()
    expect(document.body.textContent).not.toContain('2 people match')
  })
})
