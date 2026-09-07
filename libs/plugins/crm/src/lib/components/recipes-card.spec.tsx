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
 * The Recipes card (AGL-2639): the org hub's door to a site's automations.
 *
 * What it must hold: it mounts at the organization level and not under a
 * site; it lists every recipe with the sites that carry it, read from the
 * status route, and names a site with unstamped actions as one that MAY
 * already have it; Install opens a drawer, posts the site the reader picks
 * — and the form, for the recipe that needs one — to the install route,
 * then links to that site's Actions page; and a refusal is shown with its
 * reason rather than swallowed.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CrmRecipeSiteStatus } from '../constants/api-routes'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import RecipesCard from './recipes-card'
import { CrmSettingsSection } from './settings-section'

/** What the status route answers, per site; a site absent here is unread. */
let statusSites: CrmRecipeSiteStatus[]
/** What the install route answers: a status and a payload. */
let installAnswer: { status: number; payload: Record<string, unknown> }
/** Every call the card made, in order. */
let calls: Array<{ route: string; payload: Record<string, unknown> }>
/** The forms each site holds, as the picker reads them. */
let formsBySite: Record<string, Array<Record<string, unknown>>>

/**
 * One stable function, as the real hook answers one: a mock that minted a
 * new function per render would change the card's refresh callback every
 * render and re-fire the status effect without end.
 */
const mockApi = jest.fn(async (route: string, payload: Record<string, unknown>) => {
  calls.push({ route, payload })
  if (route === 'recipe-status') {
    return { response: { ok: true }, payload: { ok: true, sites: statusSites } }
  }
  return {
    response: { ok: installAnswer.status < 400 },
    payload: installAnswer.payload,
  }
})
jest.mock('./use-crm-api', () => ({
  useCrmApi: () => mockApi,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreDoc: () => ({ data: { role: 'owner' }, status: 'success', fromCache: false }),
  useFirestoreCollection: (build: () => { path?: string } | null) => {
    const path = build()?.path ?? ''
    const site = path.split('/')[1] ?? ''
    return { data: path ? (formsBySite[site] ?? []) : undefined, status: 'success', fromCache: false }
  },
  collectionCeiling: (ref: { path: string }) => ref,
  ceilingedWindow: (rows: unknown[] | undefined) => ({ rows, truncated: false }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: jest.fn(async () => undefined),
  deleteField: () => ({ __delete: true }),
  FieldPath: class {
    segments: string[]
    constructor(...segments: string[]) {
      this.segments = segments
    }
  },
}))
jest.mock('../hooks/use-org-member-directory', () => ({
  useOrgMemberDirectory: () => ({
    members: [],
    loading: false,
    error: null,
    nameOf: (uid: string) => uid,
  }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: () => null,
}))
const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

const HOSTS = [
  { id: 'host-a', name: 'Demo Bakery', subdomain: 'demo' },
  { id: 'host-b', name: 'Second Site', subdomain: 'second' },
  { id: 'host-c', name: 'Unlinked Site', subdomain: null },
]

function Mount(props: { children: ReactNode; hosts?: typeof HOSTS; hostsReady?: boolean }) {
  const { children, hosts = HOSTS, hostsReady = true } = props
  return (
    <CrmOrgMountProvider
      mount={{ orgId: 'org-1', hosts, hostsReady, hostsPath: '/acme/hosts' }}
    >
      {children}
    </CrmOrgMountProvider>
  )
}

/** A plan that carries the actions builder, so nothing is refused for that reason. */
const ORG = { plan: 'business' } as never

const renderCard = (org: unknown = ORG) =>
  render(
    <Mount>
      <RecipesCard org={org as never} />
    </Mount>,
  )

const card = () => screen.getByRole('region', { name: 'Recipes' })
const rowOf = (title: string) => within(card()).getByRole('row', { name: new RegExp(title) })
const pick = (label: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}
const statusRead = () =>
  waitFor(() => expect(calls.filter((c) => c.route === 'recipe-status')).toHaveLength(1))
/** The drawer's own Install button — named exactly, unlike the rows' "Install <recipe>". */
const drawerInstall = () => screen.getByRole('button', { name: 'Install' }) as HTMLButtonElement

beforeEach(() => {
  jest.clearAllMocks()
  window.sessionStorage.clear()
  calls = []
  formsBySite = {}
  statusSites = [
    { hostId: 'host-a', installed: ['welcomeNewLead'], unstamped: 0 },
    { hostId: 'host-b', installed: [], unstamped: 2 },
    { hostId: 'host-c', installed: ['welcomeNewLead'], unstamped: 0 },
  ]
  installAnswer = {
    status: 201,
    payload: { ok: true, actionId: 'new-1', name: 'Follow up a won deal', recipeId: 'followUpWonDeal' },
  }
})

describe('where the card mounts', () => {
  it('is the last card of the org-level Settings section, and absent under a site', async () => {
    const { unmount } = render(
      <Mount>
        <CrmSettingsSection hostId={null} org={ORG} />
      </Mount>,
    )
    const regions = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(regions[regions.length - 1]).toBe('Recipes')
    await statusRead()
    unmount()
    render(<CrmSettingsSection hostId="host-a" org={ORG} />)
    expect(screen.queryByRole('region', { name: 'Recipes' })).toBeNull()
    expect(calls.filter((c) => c.route === 'recipe-status')).toHaveLength(1)
  })
})

describe('what the card reports', () => {
  it('lists every recipe with its description, and the sites that carry it, linked into their Actions page', async () => {
    renderCard()
    await statusRead()
    for (const title of [
      'Welcome a new lead',
      'Follow up a won deal',
      'Re-engage a stale lead',
      'Tag by form',
    ]) {
      expect(rowOf(title)).toBeTruthy()
    }
    const welcome = rowOf('Welcome a new lead')
    expect(welcome.textContent).toContain('rotate in an owner')
    const link = within(welcome).getByRole('link', { name: 'Demo Bakery' })
    expect(link.getAttribute('href')).toBe('/acme/hosts/demo/automation/actions')
    // A site whose subdomain the mount could not answer is named, not linked.
    expect(welcome.textContent).toContain('Unlinked Site')
    expect(within(welcome).queryByRole('link', { name: 'Unlinked Site' })).toBeNull()
    expect(welcome.textContent).not.toContain('Not installed')
  })

  it('names a site with unstamped actions as one that may already have it, and a clean slate as not installed', async () => {
    renderCard()
    await statusRead()
    const followUp = rowOf('Follow up a won deal')
    expect(followUp.textContent).toContain('Not installed on any site yet.')
    expect(followUp.textContent).toContain('May already have it: Second Site')
    // The welcome row: installed on two sites, and Second Site may have it too.
    expect(rowOf('Welcome a new lead').textContent).toContain('May already have it: Second Site')
  })

  it('reads the status once the site list is known, and only then', async () => {
    render(
      <Mount hostsReady={false}>
        <RecipesCard org={ORG} />
      </Mount>,
    )
    expect(rowOf('Welcome a new lead').textContent).toContain('Reading…')
    expect(calls).toEqual([])
    expect(
      (within(rowOf('Welcome a new lead')).getByRole('button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('disables Install, with the reason, on a plan without the actions builder', async () => {
    renderCard({ plan: 'starter' })
    await statusRead()
    expect(
      (within(rowOf('Welcome a new lead')).getByRole('button') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(card().textContent).toMatch(/requires the .* plan/)
  })
})

describe('installing', () => {
  it('posts the picked site to the install route, then links to that site’s Actions page and re-reads the status', async () => {
    renderCard()
    await statusRead()
    fireEvent.click(screen.getByRole('button', { name: 'Install Follow up a won deal' }))
    expect(screen.getByRole('heading', { name: 'Install “Follow up a won deal”' })).toBeTruthy()
    // No session pick and three sites: nothing is chosen for the reader.
    expect(drawerInstall().disabled).toBe(true)
    pick('Site', 'Second Site — may already have it')
    expect(drawerInstall().disabled).toBe(false)
    fireEvent.click(drawerInstall())
    await waitFor(() => expect(calls.some((c) => c.route === 'recipe-install')).toBe(true))
    expect(calls.find((c) => c.route === 'recipe-install')).toEqual({
      route: 'recipe-install',
      payload: { hostId: 'host-b', recipeId: 'followUpWonDeal' },
    })
    // The drawer closes on success. Its body unmounts at once, but the
    // Drawer's exit transition keeps the rest of the page aria-hidden until
    // it ends, so the link is awaited rather than read.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Install “Follow up a won deal”' })).toBeNull(),
    )
    expect(screen.getByText('Installed “Follow up a won deal” on Second Site.')).toBeTruthy()
    const link = await screen.findByRole('link', { name: 'Open Automation → Actions' })
    expect(link.getAttribute('href')).toBe('/acme/hosts/second/automation/actions')
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      'Installed “Follow up a won deal” on Second Site',
      expect.anything(),
    )
    await waitFor(() =>
      expect(calls.filter((c) => c.route === 'recipe-status')).toHaveLength(2),
    )
  })

  it('offers a site that already carries the recipe only as disabled, marked installed', async () => {
    renderCard()
    await statusRead()
    fireEvent.click(screen.getByRole('button', { name: 'Install Welcome a new lead' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Site' }))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    const demo = options.find((option) => option.textContent === 'Demo Bakery — installed')
    expect(demo?.getAttribute('aria-disabled')).toBe('true')
    expect(options.map((option) => option.textContent)).toEqual([
      'Demo Bakery — installed',
      'Second Site — may already have it',
      'Unlinked Site — installed',
    ])
  })

  it('asks for one of the picked site’s live forms for Tag by form, and posts it', async () => {
    formsBySite['host-b'] = [
      { $id: 'form-contact', displayName: 'Contact us' },
      { $id: 'form-old', displayName: 'Old form', archivedAt: { seconds: 1 } },
      { $id: 'form-bare' },
    ]
    installAnswer = {
      status: 201,
      payload: { ok: true, actionId: 'new-2', name: 'Tag Contact us submissions', recipeId: 'tagByForm' },
    }
    renderCard()
    await statusRead()
    fireEvent.click(screen.getByRole('button', { name: 'Install Tag by form' }))
    const form = () => screen.getByRole('combobox', { name: 'Form' })
    expect(form().getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Pick the site first; the recipe is keyed on one of its forms.')).toBeTruthy()
    pick('Site', 'Second Site — may already have it')
    expect(drawerInstall().disabled).toBe(true)
    fireEvent.mouseDown(form())
    // Live forms only, by name, the nameless one by its id.
    expect(
      within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Contact us', 'form-bare'])
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Contact us' }))
    fireEvent.click(drawerInstall())
    await waitFor(() => expect(calls.some((c) => c.route === 'recipe-install')).toBe(true))
    expect(calls.find((c) => c.route === 'recipe-install')?.payload).toEqual({
      hostId: 'host-b',
      recipeId: 'tagByForm',
      formId: 'form-contact',
    })
  })

  it('shows a refusal with its reason and keeps the drawer open', async () => {
    installAnswer = { status: 409, payload: { error: 'Already installed on this site', actionId: 'x' } }
    renderCard()
    await statusRead()
    fireEvent.click(screen.getByRole('button', { name: 'Install Re-engage a stale lead' }))
    pick('Site', 'Demo Bakery')
    fireEvent.click(drawerInstall())
    await waitFor(() => expect(screen.getByText('Already installed on this site')).toBeTruthy())
    // The drawer is still up, with its picks.
    expect(screen.getByRole('heading', { name: 'Install “Re-engage a stale lead”' })).toBeTruthy()
    expect(screen.queryByText(/^Installed “/)).toBeNull()
    expect(enqueueSnackbar).not.toHaveBeenCalled()
    expect(calls.filter((c) => c.route === 'recipe-status')).toHaveLength(1)
  })

  it('starts from the session’s picked site when that site does not already carry the recipe', async () => {
    window.sessionStorage.setItem('aglyn.crm.createSite.org-1', 'host-b')
    renderCard()
    await statusRead()
    fireEvent.click(screen.getByRole('button', { name: 'Install Follow up a won deal' }))
    expect(screen.getByRole('combobox', { name: 'Site' }).textContent).toContain('Second Site')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    window.sessionStorage.setItem('aglyn.crm.createSite.org-1', 'host-a')
  })
})
