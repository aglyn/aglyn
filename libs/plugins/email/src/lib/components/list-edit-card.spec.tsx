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
 * THE AUDIENCE'S SETTINGS PAGE, and the two things it must not get wrong.
 *
 * 1. **The whole rule reaches Firestore.** The editor exists because nine
 *    stored fields were reachable by four controls. A save that wrote back
 *    only the four the old form knew would look identical on screen and would
 *    silently delete the other five from any rule that had them.
 * 2. **A live list and a fixed one are told apart in words.** The same filters
 *    serve both; the difference is whether the audience keeps growing. A
 *    reader who cannot tell which they have cannot predict who gets mailed.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ListEditCard } from './list-edit-card'

const BASE_PATH = '/acme/hosts/site/emails'
const LIST_PATH = 'orgs/org-1/lists/list-1'

/** The stored list, swapped per test before mounting. */
let listDoc: Record<string, any> | undefined

const FIRESTORE = {}
const SCOPE = { scope: ['orgs', 'org-1'] }
const NO_SEGMENTS = { data: [] }
const SITE_CAMPAIGNS = {
  options: [{ value: 'camp_spring', label: 'Spring push' }],
  truncated: false,
  ready: true,
}
const mockPush = jest.fn()
/** Every site the campaign picker was read for, in order. */
const campaignsAskedFor: string[] = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: () => undefined }),
  usePathname: () => `${BASE_PATH}/audiences/list-1/edit`,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => SCOPE,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useFirestoreCollection: () => NO_SEGMENTS,
  useFirestoreDoc: () => ({ data: listDoc, status: 'success' }),
  // The site's campaigns behind the "In campaign" picker. Offered rather than
  // empty, so a rule that already names one renders the campaign it names —
  // a picker whose value is not among its options draws blank, and a save
  // from that screen would erase the reference. The site it was asked for is
  // recorded, because that is the site whose people the filters read.
  useHostCampaigns: (hostId: string) => {
    campaignsAskedFor.push(hostId)
    return SITE_CAMPAIGNS
  },
  // The org roster behind the "Owned by" audience control (AGL-2603): empty
  // and settled, so the control renders and the rule round-trips without a
  // members read this suite has no business making.
  useOrgMemberOptions: () => ({ options: [], ready: true, error: null }),
  // The reader's scope tokens behind the custom-field condition control
  // (AGL-2603): an org-wide reader, settled, so the definitions read is shaped
  // and the control renders.
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
}))

const updateDoc = jest.fn().mockResolvedValue(undefined)
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  query: (base: any) => base,
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: (...args: unknown[]) => updateDoc(...args),
}))

jest.mock('@aglyn/aglyn', () => {
  // The rule model is real: `normalizeDynamicListRule` is what decides which
  // fields survive a save, and a stub of it would make this file's central
  // assertion a claim about the stub.
  const actual = jest.requireActual('@aglyn/aglyn')
  return { ...actual, pluginDocsHelp: () => undefined }
})
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
  AppLink: ({ href, children }: any) => <a href={href}>{children}</a>,
  MdiIcon: () => null,
}))

/** A rule using every dimension the model has. */
const FULL_RULE = {
  sources: ['contacts'],
  segmentId: 'seg_1',
  tags: ['vip'],
  captureSources: ['order'],
  formNames: ['Contact us'],
  campaignIds: ['camp_spring'],
  createdAfterMs: Date.parse('2026-01-01'),
  createdBeforeMs: Date.parse('2026-06-30'),
  behavior: {
    ordersCountAtLeast: 2,
    ltvCentsAtLeast: 50_000,
    lastPurchaseWithinDays: 90,
    noPurchaseForDays: 30,
  },
}

const mount = async () => {
  updateDoc.mockClear()
  mockPush.mockClear()
  campaignsAskedFor.length = 0
  render(
    <ListEditCard hostId="host-1" listId="list-1" basePath={BASE_PATH} />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const save = () => fireEvent.click(screen.getByText('Save'))
const written = () => updateDoc.mock.calls[0][1]

describe('the edit page writes the WHOLE rule', () => {
  beforeEach(() => {
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: FULL_RULE }
  })

  it('THE CONTROL: the fixture reaches the form at all', async () => {
    // Every assertion below is "field X survived the save", and a page that
    // never loaded the rule would satisfy them by writing an empty one that
    // happens to equal an empty expectation. This is the reading that proves
    // the stored rule is on screen.
    await mount()
    expect(
      (screen.getByLabelText('Tagged') as HTMLInputElement).value,
    ).toBe('vip')
    expect(
      (screen.getByLabelText('Spent at least') as HTMLInputElement).value,
    ).toBe('500')
  })

  it('saves every field it was given, unchanged', async () => {
    await mount()
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(updateDoc.mock.calls[0][0].path).toBe(LIST_PATH)
    expect(written().rule).toEqual(FULL_RULE)
  })

  it('THE TRAP: it does not write back only the four the old form knew', async () => {
    // The precise regression this page exists to prevent. A save that carried
    // sources, tags, form names and created-after would look right on screen
    // and would delete the segment, the capture sources, the closing date and
    // the entire purchase-behavior block from a rule that had them.
    await mount()
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    const rule = written().rule
    expect(rule.segmentId).toBe('seg_1')
    expect(rule.captureSources).toEqual(['order'])
    expect(rule.createdBeforeMs).toBe(FULL_RULE.createdBeforeMs)
    expect(rule.behavior).toEqual(FULL_RULE.behavior)
    // The campaign the audience is built from. A save that dropped it would
    // widen the list from the people in one push to the whole silo, and the
    // sweep would enroll them on the next beat.
    expect(rule.campaignIds).toEqual(['camp_spring'])
  })

  it('carries an edited field through and leaves the rest alone', async () => {
    await mount()
    fireEvent.change(screen.getByLabelText('Orders at least'), {
      target: { value: '7' },
    })
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written().rule.behavior.ordersCountAtLeast).toBe(7)
    expect(written().rule.behavior.ltvCentsAtLeast).toBe(50_000)
  })
})

describe('renaming', () => {
  beforeEach(() => {
    listDoc = { name: 'Newsletter', kind: 'manual', rule: { sources: [] } }
  })

  it('writes the new name to the list document', async () => {
    await mount()
    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: 'Weekly digest' },
    })
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(updateDoc.mock.calls[0][0].path).toBe(LIST_PATH)
    expect(written().name).toBe('Weekly digest')
  })

  it('refuses to blank the name, and says so before the click', async () => {
    /*
     * An empty name is not a rename. The audiences table orders on `name`, and
     * `orderBy` drops a document that does not carry the field — so a list
     * renamed to nothing would vanish from the page that lists it.
     *
     * Asserted on the CONTROL and on the write, because they are two different
     * refusals: a disabled Save is the one the merchant meets, and the guard
     * inside the handler is what a stale closure meets. A test that only
     * pressed the button would pass with the second one deleted.
     */
    await mount()
    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: '   ' },
    })
    expect(
      (screen.getByText('Save').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    save()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('THE CONTROL: a real name leaves Save live', async () => {
    // Otherwise "Save is disabled" above is satisfied by a button that is
    // always disabled, and the whole page would be untestably inert.
    await mount()
    expect(
      (screen.getByText('Save').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('returns to the audience once it is saved', async () => {
    await mount()
    save()
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/audiences/list-1`)
  })
})

describe('live and fixed are told apart in words', () => {
  it('a live list says the membership keeps growing', async () => {
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: FULL_RULE }
    await mount()
    expect(document.body.textContent).toContain('enrolled automatically')
    expect(document.body.textContent).not.toContain('does not change on its own')
  })

  it('a fixed list says the membership does not change on its own', async () => {
    listDoc = { name: 'Newsletter', kind: 'manual', rule: { sources: [] } }
    await mount()
    expect(document.body.textContent).toContain('does not change on its own')
    expect(document.body.textContent).not.toContain('enrolled automatically')
  })

  it('switching the membership is what the save records', async () => {
    // The filters are the same either way; the kind is the whole difference,
    // so it has to be the thing that is written.
    listDoc = { name: 'Newsletter', kind: 'manual', rule: { sources: [] } }
    await mount()
    expect(written).toBeDefined()
    fireEvent.mouseDown(screen.getByLabelText('Membership'))
    fireEvent.click(screen.getByText('Live — keeps growing'))
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written().kind).toBe('dynamic')
  })

  it('a live list drawing from nothing is warned about', async () => {
    // A rule with no source matches nobody, and the next sweep would empty the
    // audience of everyone it had enrolled.
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: { sources: [] } }
    await mount()
    expect(document.body.textContent).toContain('match nobody')
  })

  it('and a FIXED list drawing from nothing is not', async () => {
    // THE CONTROL for the warning above. On a fixed list an unset filter
    // selects nobody to add and takes nobody off, so the same words there
    // would be a warning about a consequence that does not exist.
    listDoc = { name: 'Newsletter', kind: 'manual', rule: { sources: [] } }
    await mount()
    expect(document.body.textContent).not.toContain('match nobody')
  })
})

/*==========================================
 * WHOSE PEOPLE THE FILTERS READ IS WRITTEN WHEN SOMEBODY CHOOSES IT.
 *
 * A list is the organization's and its rule reads one site's people — the
 * list's `hostId`. A save that wrote the site whose page it was made on would
 * let a rename on another site's page quietly move the whole audience onto
 * that site's customers at the next sweep.
 *=========================================*/
describe('the site the filters read', () => {
  it('is not moved by a save made on another site’s page', async () => {
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: FULL_RULE, hostId: 'host-2' }
    await mount()
    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: 'VIP customers' },
    })
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written().name).toBe('VIP customers')
    expect(written()).not.toHaveProperty('hostId')
  })

  it('reads the pickers for the stored site, and says it is another one', async () => {
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: FULL_RULE, hostId: 'host-2' }
    await mount()
    expect(campaignsAskedFor).toContain('host-2')
    expect(campaignsAskedFor).not.toContain('host-1')
    expect(document.body.textContent).toContain('read another site’s people')
  })

  it('moves to this site when the author says so', async () => {
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: FULL_RULE, hostId: 'host-2' }
    await mount()
    fireEvent.click(screen.getByText('Use this site'))
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written().hostId).toBe('host-1')
  })

  it('THE CONTROL: a list that names no site takes the one it is set up on', async () => {
    // Otherwise "never written" above is satisfied by a card that never
    // writes the field at all, and a new list would reach the sweep with no
    // site to read and be skipped forever.
    listDoc = { name: 'Newsletter', kind: 'manual', rule: { sources: [] } }
    await mount()
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written().hostId).toBe('host-1')
  })

  it('writes nothing new for a list already on this site', async () => {
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: FULL_RULE, hostId: 'host-1' }
    await mount()
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written()).not.toHaveProperty('hostId')
    expect(document.body.textContent).not.toContain('another site’s people')
  })
})

/*==========================================
 * ON THE ORGANIZATION'S EMAILS PAGE.
 *
 * No site in the URL, so the site the filters read is a picker: the stored
 * one when the org still has it, else the reader's pick, else the only site.
 *=========================================*/
describe('editing a list on the organization’s page', () => {
  const TWO_SITES = [
    { id: 'host-1', name: 'Store', subdomain: 'store' },
    { id: 'host-2', name: 'Blog', subdomain: 'blog' },
  ]

  const mountAtOrg = async (hosts = TWO_SITES) => {
    updateDoc.mockClear()
    mockPush.mockClear()
    campaignsAskedFor.length = 0
    // A pick made in one test is the session's pick in the next; each starts
    // from a session that has chosen nothing.
    window.sessionStorage.clear()
    const { EmailOrgMountProvider } = await import('./email-org-mount')
    render(
      <EmailOrgMountProvider
        mount={{
          orgId: 'org-1',
          orgSlug: 'acme',
          hosts,
          hostsReady: true,
          hostsPath: '/acme/hosts',
        }}
        basePath="/acme/emails"
      >
        <ListEditCard hostId={null} listId="list-1" basePath="/acme/emails" />
      </EmailOrgMountProvider>,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('starts on the stored site and leaves it alone on save', async () => {
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: FULL_RULE, hostId: 'host-2' }
    await mountAtOrg()
    expect(new Set(campaignsAskedFor)).toEqual(new Set(['host-2']))
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(updateDoc.mock.calls[0][0].path).toBe(LIST_PATH)
    expect(written()).not.toHaveProperty('hostId')
  })

  it('writes the site the author picks', async () => {
    listDoc = { name: 'VIPs', kind: 'dynamic', rule: FULL_RULE, hostId: 'host-2' }
    await mountAtOrg()
    fireEvent.mouseDown(screen.getByLabelText('Site'))
    fireEvent.click(screen.getByRole('option', { name: 'Store' }))
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written().hostId).toBe('host-1')
  })

  it('asks before drawing the filters for a list with no site, when there is a choice', async () => {
    listDoc = { name: 'Newsletter', kind: 'manual', rule: { sources: [] } }
    await mountAtOrg()
    expect(campaignsAskedFor).toHaveLength(0)
    expect(document.body.textContent).toContain('Choose the site whose people')
  })

  it('takes the only site without asking', async () => {
    listDoc = { name: 'Newsletter', kind: 'manual', rule: { sources: [] } }
    await mountAtOrg([TWO_SITES[0]])
    expect(new Set(campaignsAskedFor)).toEqual(new Set(['host-1']))
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written().hostId).toBe('host-1')
  })
})

describe('the session’s pick on the organization’s page', () => {
  it('defaults a list with no site to the site picked earlier in the session', async () => {
    window.sessionStorage.setItem('aglyn.emails.site.org-1', 'host-2')
    listDoc = { name: 'Newsletter', kind: 'manual', rule: { sources: [] } }
    updateDoc.mockClear()
    campaignsAskedFor.length = 0
    const { EmailOrgMountProvider } = await import('./email-org-mount')
    render(
      <EmailOrgMountProvider
        mount={{
          orgId: 'org-1',
          orgSlug: 'acme',
          hosts: [
            { id: 'host-1', name: 'Store', subdomain: 'store' },
            { id: 'host-2', name: 'Blog', subdomain: 'blog' },
          ],
          hostsReady: true,
          hostsPath: '/acme/hosts',
        }}
        basePath="/acme/emails"
      >
        <ListEditCard hostId={null} listId="list-1" basePath="/acme/emails" />
      </EmailOrgMountProvider>,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(new Set(campaignsAskedFor)).toEqual(new Set(['host-2']))
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(written().hostId).toBe('host-2')
    window.sessionStorage.clear()
  })
})

