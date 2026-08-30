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
 *  3. Neither the campaigns read nor the composer's own listens happen until
 *     somebody asks for them. This list is read by people who came to look at
 *     a table.
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
/** The props the composer was mounted with, or null while it is not. */
let composerProps: Record<string, any> | null = null

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
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
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
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
 * The composer, recorded rather than mounted.
 *
 * It opens four listens of its own, so mounting the real one here would make
 * every assertion about this card's read cost meaningless — and what is under
 * test is which campaign the card hands it, not what it does with one.
 */
jest.mock('./campaign-composer', () => ({
  __esModule: true,
  default: (props: any) => {
    composerProps = props
    return <div>{'composer mounted'}</div>
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
  composerProps = null
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

  it('hands the composer NO campaign for a single send', async () => {
    /*
     * The property the whole design rests on. An empty container is what
     * every send predating campaigns carries, and the campaigns table adopts
     * it as a campaign of one — so nothing is minted here and nobody is made
     * to create a campaign before they can write.
     */
    await mount()
    await openDrawer()
    await submitDrawer()

    expect(composerProps?.emailCampaignId).toBeUndefined()
    expect(composerProps?.displayName).toBe('Spring promo')
  })

  it('hands the composer the campaign when one was picked', async () => {
    await mount()
    formValues = { displayName: 'Third mailing', emailCampaignId: 'camp_1' }
    await openDrawer()
    await submitDrawer()

    expect(composerProps?.emailCampaignId).toBe('camp_1')
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

  it('does NOT mount the composer until the drawer submits', async () => {
    await mount()
    expect(composerProps).toBeNull()

    await openDrawer()
    expect(composerProps).toBeNull()

    await submitDrawer()
    expect(composerProps).not.toBeNull()
  })

  it('closes the drawer once composing has started', async () => {
    await mount()
    await openDrawer()
    await submitDrawer()

    expect(screen.queryByText('Submit email')).toBeNull()
    expect(screen.getByText('composer mounted')).toBeTruthy()
  })
})
