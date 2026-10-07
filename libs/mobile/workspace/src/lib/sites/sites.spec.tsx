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

import { mockWindow, PHONE, TABLET } from '../spec-native-mocks'

const mockList = {
  options: null as any,
  state: { rows: [] as any[], ready: true, error: null as Error | null, hasMore: false, loadMore: jest.fn(), plan: { notices: [] as string[] } },
}
const mockDocs: Record<string, unknown> = {}
const mockWorkspace = { selectSite: jest.fn() }

jest.mock('@aglyn/mobile-core', () => ({
  searchWords: (text: string) => text.split(/\s+/).filter(Boolean),
  mobileBrandName: () => 'Aglyn',
  useMobileListQuery: (options: unknown) => {
    mockList.options = options
    return mockList.state
  },
  useLiveDoc: (_firestore: unknown, path: string[] | null) => {
    if (!path) return { data: null, ready: false, error: null }
    const key = path.join('/')
    return key in mockDocs ? { data: mockDocs[key], ready: true, error: null } : { data: null, ready: true, error: null }
  },
  useWorkspace: () => mockWorkspace,
}))

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { SITE_LIST_DECLARATION } from '@aglyn/aglyn/app-utils/site-list-query'
import { planListQuery } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { fakeContext } from '../spec-support'
import SiteScreen from './site-screen'
import { hostDisplayDomain, siteLiveUrl } from './site-model'
import SitesScreen from './sites-screen'
import { siteListClauses } from './use-sites'

const LIVE_HOST = {
  $id: 'site-2',
  displayName: 'Bloom Bakery',
  subdomain: 'bloom',
  cname: 'bloombakery.com',
  screens: { home: '', menu: 'menu' },
  defaultHomeScreenId: 'home',
  memberRoles: { 'owner-uid': 'admin' },
}

beforeEach(() => {
  mockWindow.size = PHONE
  mockList.state = { rows: [], ready: true, error: null, hasMore: false, loadMore: jest.fn(), plan: { notices: [] } }
  for (const key of Object.keys(mockDocs)) delete mockDocs[key]
  mockWorkspace.selectSite.mockReset()
})

describe('the Sites list query', () => {
  it("asks the console's query: the workspace, the Custom domain clause and the search, by name", () => {
    const plan = planListQuery(
      SITE_LIST_DECLARATION,
      { clauses: siteListClauses('true'), search: ['bloom'], base: [{ path: 'orgId', op: '==', value: 'org-1' }] },
      nameSearchNormalizers,
    )
    expect(plan.refused).toEqual([])
    expect(plan.filters).toEqual(
      expect.arrayContaining([
        { path: 'orgId', op: '==', value: 'org-1' },
        { path: 'hasCustomDomain', op: '==', value: true },
      ]),
    )
    expect(plan.searched).toBe('bloom')
    expect(siteListClauses('all')).toEqual([])
  })

  it('reads the addresses the console prints', () => {
    expect(hostDisplayDomain({ subdomain: 'bloom' })).toBe('bloom.aglyn.app')
    expect(siteLiveUrl({ subdomain: 'bloom', cname: 'bloombakery.com' })).toBe('https://bloombakery.com/')
  })
})

describe('SitesScreen', () => {
  it('shows a skeleton while loading', async () => {
    mockList.state = { ...mockList.state, ready: false }
    await render(<SitesScreen params={{}} context={fakeContext()} />)
    expect(screen.getByTestId('sites-loading')).toBeTruthy()
  })

  it('says when the sites could not be loaded', async () => {
    mockList.state = { ...mockList.state, error: new Error('denied') }
    await render(<SitesScreen params={{}} context={fakeContext()} />)
    expect(screen.getByText('These sites could not be loaded')).toBeTruthy()
  })

  it('has an empty state, and a different one under a filter', async () => {
    await render(<SitesScreen params={{}} context={fakeContext()} />)
    expect(screen.getByText('No sites yet')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('sites-domain-true'))
    expect(screen.getByText('No sites match these filters')).toBeTruthy()
    expect(mockList.options.request.clauses).toEqual([{ field: 'hasCustomDomain', op: 'is', value: 'true' }])
  })

  it("queries the reader's memberships in the picked workspace, and searches", async () => {
    await render(<SitesScreen params={{}} context={fakeContext()} />)
    expect(mockList.options.path).toEqual(['users', 'owner-uid', 'hostMemberships'])
    expect(mockList.options.request.base).toEqual([{ path: 'orgId', op: '==', value: 'org-1' }])
    await fireEvent.changeText(screen.getByTestId('sites-search'), 'bloom bakery')
    expect(mockList.options.request.search).toEqual(['bloom', 'bakery'])
  })

  it("draws each row's status from its host and pushes the site on a phone", async () => {
    mockList.state = { ...mockList.state, rows: [{ $id: 'site-2', displayName: 'Bloom Bakery', subdomain: 'bloom' }] }
    mockDocs['hosts/site-2'] = LIVE_HOST
    const context = fakeContext()
    await render(<SitesScreen params={{}} context={context} />)
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText('bloombakery.com')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('site-site-2'))
    expect(context.navigate).toHaveBeenCalledWith('workspace.site', { hostId: 'site-2' })
  })

  it('shows the list and the site side by side on a tablet', async () => {
    mockWindow.size = TABLET
    mockList.state = { ...mockList.state, rows: [{ $id: 'site-2', displayName: 'Bloom Bakery', subdomain: 'bloom' }] }
    mockDocs['hosts/site-2'] = LIVE_HOST
    const context = fakeContext()
    await render(<SitesScreen params={{}} context={context} />)
    expect(screen.getByTestId('split-view')).toBeTruthy()
    expect(screen.getByText('Pick a site to see it here')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('site-site-2'))
    expect(context.navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('site-open-besigner')).toBeTruthy()
  })
})

describe('the site detail', () => {
  it('shows the status, the addresses and the role', async () => {
    mockDocs['hosts/site-2'] = LIVE_HOST
    mockDocs['users/owner-uid/hostMemberships/site-2'] = { role: 'admin' }
    mockDocs['hosts/site-2/screens/home'] = { versionId: 'v7', publishedAt: { seconds: 1_790_000_000 } }
    await render(<SiteScreen params={{ hostId: 'site-2' }} context={fakeContext()} />)
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText('2 published pages.')).toBeTruthy()
    expect(screen.getByText('bloom.aglyn.app')).toBeTruthy()
    expect(screen.getByText('Admin')).toBeTruthy()
    expect(screen.getByText('Home page last published')).toBeTruthy()
  })

  it("opens the home page in the Besigner, the Pages list, and the live site", async () => {
    mockDocs['hosts/site-2'] = LIVE_HOST
    mockDocs['hosts/site-2/screens/home'] = { versionId: 'v7' }
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const context = fakeContext()
    await render(<SiteScreen params={{ hostId: 'site-2' }} context={context} />)
    await fireEvent.press(screen.getByTestId('site-open-besigner'))
    expect(context.openConsolePath).toHaveBeenLastCalledWith('/acme/hosts/bloom/screens/home/versions/v7/besigner', 'absolute')
    await fireEvent.press(screen.getByTestId('site-open-pages'))
    expect(context.openConsolePath).toHaveBeenLastCalledWith('/acme/hosts/bloom/screens', 'absolute')
    await fireEvent.press(screen.getByTestId('site-view-live'))
    expect(open).toHaveBeenCalledWith('https://bloombakery.com/')
  })

  it('opens the Pages list when there is no home page version, and a draft says so', async () => {
    mockDocs['hosts/site-3'] = { subdomain: 'studio', displayName: 'Studio' }
    const context = fakeContext()
    await render(<SiteScreen params={{ hostId: 'site-3' }} context={context} />)
    expect(screen.getByText('Draft')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('site-open-besigner'))
    expect(context.openConsolePath).toHaveBeenLastCalledWith('/acme/hosts/studio/screens', 'absolute')
  })

  it("switches the app's site, and says so for the picked one", async () => {
    mockDocs['hosts/site-2'] = LIVE_HOST
    await render(<SiteScreen params={{ hostId: 'site-2' }} context={fakeContext()} />)
    await fireEvent.press(screen.getByTestId('site-pick'))
    expect(mockWorkspace.selectSite).toHaveBeenCalledWith('site-2')

    mockDocs['hosts/site-1'] = { subdomain: 'shop' }
    await render(<SiteScreen params={{}} context={fakeContext()} />)
    expect(screen.getByTestId('site-is-picked')).toBeTruthy()
  })

  it('says when a site cannot be opened', async () => {
    await render(<SiteScreen params={{ hostId: 'gone' }} context={fakeContext()} />)
    expect(screen.getByText('This site could not be opened')).toBeTruthy()
  })
})
