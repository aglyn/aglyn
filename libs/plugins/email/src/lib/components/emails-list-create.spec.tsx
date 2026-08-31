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
 *
 * @jest-environment jsdom
 */

/**
 * WRITING AN EMAIL FROM THE EMAILS LIST.
 *
 * The list had no create affordance at all: the composer was mounted only on
 * a campaign's own page, so writing anything meant inventing a campaign
 * first. What this holds is the shape of the fix rather than the composer,
 * which has its own tests.
 *
 *  1. Create is the shared DRAWER, per the console's rule — never a form
 *     above the table.
 *  2. An email written here belongs to a campaign, or to NO campaign. The
 *     second is a real answer: a send with no container is what every message
 *     predating campaigns is, `campaignListRows` adopts each as a campaign of
 *     one at read time, and the campaigns table already marks those "Single
 *     send". Nothing is minted and nobody has to create a campaign first.
 *  3. The campaigns read does not happen until somebody asks for it. This
 *     list is read by people who came to look at a table.
 *  4. Create MINTS the record and goes to its own page. The composer belongs
 *     on the email's page, not under this table — a list page carries no
 *     form, wherever on it the form sits.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const FIRESTORE = {}

/** Every collection path a listen was opened on, in order. */
let listened: string[] = []
/** Documents the doubles serve, by collection name. */
let served: Record<string, any[]> = {}
/** The extra fields the card handed the create drawer. */
let drawerFields: any[] = []
/** What the create form submits when its button is pressed. */
let formValues: Record<string, any> = {}
/** Every request the card POSTed to the campaign API, in order. */
let posted: Record<string, any>[] = []
/** What that API answers with. */
let apiResult: { response: { ok: boolean }; payload: Record<string, any> }
/** Where the card navigated, or null while it has not. */
let pushed: string | null = null

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  // The card reports a failed create through a snackbar. The console mounts
  // this provider at its root and no test tree has it, so without the mock
  // the hook answers null and the card cannot render at all.
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  // Nobody signed in. The card's create action posts through
  // `useCampaignSendApi`, which reads the user to mint a token; no test here
  // creates, so the hook only has to exist.
  useUser: () => ({ data: null }),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    // A null builder opens NO listener. Recording only the built ones is what
    // lets a test assert that a read did not happen.
    if (!built) return { data: [], status: 'success', fromCache: false }
    const path = String(built.path ?? '')
    listened.push(path)
    const name = path.split('/').pop() ?? ''
    return { data: served[name] ?? [], status: 'success', fromCache: false }
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushed = href
    },
    replace: jest.fn(),
  }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))

/**
 * The shared create drawer, stubbed at its own boundary — the same treatment
 * the campaigns table's spec gives it, and for the same reason: the drawer
 * and data-driven-forms are library code with their own tests, and what
 * belongs here is which fields this card asks for and what it does with the
 * values that come back.
 */
jest.mock('@aglyn/shared-ui-jsx-forms', () => ({
  CreateArtifactDrawer: ({ open, extraFields, onSubmit }: any) => {
    drawerFields = extraFields
    return open ? (
      <div>
        <button type="button" onClick={() => onSubmit(formValues)}>
          {'Submit email'}
        </button>
      </div>
    ) : null
  },
}))

/**
 * The campaign API, recorded rather than called.
 *
 * Create is now one POST — `action: 'draft'` — and what belongs here is the
 * request the card builds and what it does with the id that comes back.
 */
jest.mock('./use-campaign-send-api', () => ({
  __esModule: true,
  useCampaignSendApi: () => (payload: Record<string, unknown>) => {
    posted.push(payload)
    return Promise.resolve(apiResult)
  },
  // The row menu's discard posts through this one. Nothing in this file
  // discards; the hook only has to exist for the card to render.
  useCampaignManageApi: () => (payload: Record<string, unknown>) => {
    posted.push(payload)
    return Promise.resolve(apiResult)
  },
}))

const SEND = {
  $id: 'msg_1',
  subject: 'Spring sale',
  status: 'sent',
  sentAt: { toMillis: () => 1_700_000_000_000 },
  stats: { recipients: 100, opens: 40, clicks: 5 },
}

async function mount(options?: { sends?: any[] }): Promise<void> {
  listened = []
  drawerFields = []
  posted = []
  pushed = null
  apiResult = { response: { ok: true }, payload: { campaignId: 'msg_new' } }
  formValues = { displayName: 'Spring promo', emailCampaignId: '' }
  served = {
    campaigns: options?.sends ?? [SEND],
    emailCampaigns: [
      { $id: 'camp_2', name: 'Winter clearance' },
      { $id: 'camp_1', name: 'Spring 2026' },
    ],
  }
  const { EmailsListCard } = await import('./emails-list-card')
  render(
    (
      <EmailsListCard hostId="site1" basePath="/acme/hosts/site/emails" />
    ) as ReactNode as never,
  )
}

const openDrawer = async () => {
  await act(async () => {
    fireEvent.click(screen.getAllByText('New email')[0])
  })
}

const submitDrawer = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('Submit email'))
  })
}

describe('the emails list offers a way to write one', () => {
  it('carries a create affordance in its header', async () => {
    await mount()

    // Exactly one, in the header. The count is the assertion: a list with
    // rows must not also carry the empty state's own button.
    expect(screen.getAllByText('New email')).toHaveLength(1)
  })

  it('offers a SECOND one inside the empty state', async () => {
    /*
     * An empty list is where somebody is most likely to be looking for it,
     * and the old copy sent them to a campaign to find it. Counted rather
     * than merely found, because the header's button is on screen either way
     * — `getAllByText(...).length > 0` would pass with the empty state's
     * button deleted.
     */
    await mount({ sends: [] })

    expect(screen.getAllByText('New email')).toHaveLength(2)
    expect(screen.getByText(/Write one here/i)).toBeTruthy()
  })

  it('creates through the shared drawer, not a form above the table', async () => {
    await mount()
    expect(screen.queryByText('Submit email')).toBeNull()

    await openDrawer()

    expect(screen.getByText('Submit email')).toBeTruthy()
  })
})

describe('an email written here belongs to a campaign, or to none', () => {
  it('offers "Single send" FIRST, ahead of any campaign', async () => {
    await mount()
    await openDrawer()

    const campaignField = drawerFields.find(
      (field) => field.name === 'emailCampaignId',
    )
    expect(campaignField.options[0]).toEqual({
      value: '',
      label: 'Single send — not part of a campaign',
    })
    expect(campaignField.initialValue).toBe('')
  })

  it('offers the site’s campaigns after it', async () => {
    await mount()
    await openDrawer()

    const campaignField = drawerFields.find(
      (field) => field.name === 'emailCampaignId',
    )
    expect(campaignField.options.slice(1)).toEqual([
      { value: 'camp_1', label: 'Spring 2026' },
      { value: 'camp_2', label: 'Winter clearance' },
    ])
  })

  it('creates with NO campaign for a single send', async () => {
    /*
     * The property the whole design rests on. An empty container is what
     * every send predating campaigns carries, and the campaigns table adopts
     * it as a campaign of one — so nothing is minted here and nobody is made
     * to create a campaign before they can write.
     */
    await mount()
    await openDrawer()
    await submitDrawer()

    expect(posted).toHaveLength(1)
    expect(posted[0]['emailCampaignId']).toBeUndefined()
    expect(posted[0]['displayName']).toBe('Spring promo')
  })

  it('creates under the campaign when one was picked', async () => {
    await mount()
    formValues = { displayName: 'Third mailing', emailCampaignId: 'camp_1' }
    await openDrawer()
    await submitDrawer()

    expect(posted[0]['emailCampaignId']).toBe('camp_1')
  })
})

describe('the list page never carries the composer', () => {
  /*==========================================
   * CREATE MINTS A RECORD AND GOES TO ITS PAGE.
   *
   * An email is written on the email's own page, the way every other record
   * in this console is edited. A composer mounted below this table is the
   * same anti-pattern as an inline create form, merely further down the page,
   * so the assertions here name the composer's own controls and require that
   * none of them is on this screen.
   *=========================================*/
  it('asks for a DRAFT rather than sending anything', async () => {
    await mount()
    await openDrawer()
    await submitDrawer()

    // The action is the assertion. Anything that mails is a send this list
    // has no business taking on a merchant's behalf.
    expect(posted[0]['action']).toBe('draft')
  })

  it('routes to where the new email is WRITTEN', async () => {
    await mount()
    await openDrawer()
    await submitDrawer()

    // The record's own page is a REPORT, and a record minted a second ago has
    // nothing to report. The drawer collected the name; composing is the next
    // thing to do with it, and that is its own route.
    expect(pushed).toBe('/acme/hosts/site/emails/messages/msg_new/edit')
  })

  it('mounts NO composer on the list, before or after creating', async () => {
    await mount()
    await openDrawer()
    await submitDrawer()

    // The composer's own controls. A list page carrying any of them is the
    // shape this test exists to keep off the page.
    expect(screen.queryByText('Send campaign')).toBeNull()
    expect(screen.queryByText('Save draft')).toBeNull()
    expect(screen.queryByText('Send test')).toBeNull()
  })

  it('stays put and says so when the create fails', async () => {
    /*
     * Navigating to an email that was never created would land on a "could
     * not be loaded" page, which reads as a broken console rather than as a
     * failed create.
     */
    await mount()
    apiResult = { response: { ok: false }, payload: { error: 'Nope' } }
    await openDrawer()
    await submitDrawer()

    expect(pushed).toBeNull()
  })
})

describe('the list costs what it always did until somebody asks to write', () => {
  it('reads no campaigns until the drawer is opened', async () => {
    await mount()

    expect(listened).toEqual(['hosts/site1/campaigns'])
    expect(listened).not.toContain('hosts/site1/emailCampaigns')
  })

  it('reads them once it is', async () => {
    await mount()
    await openDrawer()

    expect(listened).toContain('hosts/site1/emailCampaigns')
  })

  it('posts nothing until the drawer submits', async () => {
    await mount()
    expect(posted).toHaveLength(0)

    await openDrawer()
    expect(posted).toHaveLength(0)

    await submitDrawer()
    expect(posted).toHaveLength(1)
  })

  it('closes the drawer once the email exists', async () => {
    await mount()
    await openDrawer()
    await submitDrawer()

    expect(screen.queryByText('Submit email')).toBeNull()
  })
})
