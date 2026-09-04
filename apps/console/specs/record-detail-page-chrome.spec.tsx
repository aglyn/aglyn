/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * A PAGE ABOUT ONE RECORD NAMES THAT RECORD.
 *
 * The heading of a detail page said the COLLECTION — `Forms` above a page
 * about one form — and the trail stopped at the collection too, so every row
 * of a list opened a page whose chrome was identical to every other row's.
 * Two tabs open on two different forms were one string.
 *
 * The routes that own their own `DashboardLayout` never had the bug: Screens,
 * Components, Layouts, Templates and content entries pass the record's name
 * as `header` and append it to `breadcrumbItems` themselves. The surfaces
 * that DID are the ones the shell's generic plugin route mounts as children,
 * which cannot set either — hence the `PageHeaderRecord` seam asserted here.
 *
 * Both ends are under test, and neither is the behavior alone: the LAYOUT
 * must render what a body publishes, and the plugin ROUTE must leave the
 * levels above the record clickable so the finished trail walks back.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import {
  PageHeaderActions,
  PageHeaderRecord,
  registerConsoleExtension,
  unregisterConsoleExtension,
  type ConsolePluginPageProps,
} from '@aglyn/aglyn'
import type { ReactNode } from 'react'

/** The URL's segments beneath the site, for the plugin-route half. */
let mockSegments: string[]
jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginSlug: mockSegments }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => `/acme/hosts/acme-site/${mockSegments.join('/')}`,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useRemoteConfig: () => ({ defaultConfig: {} }),
  useUser: () => ({
    data: {
      uid: 'u1',
      getIdToken: async () => 'tok',
      getIdTokenResult: async () => ({ claims: {} }),
    },
  }),
}))

jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => true,
  getValue: () => ({ asString: () => '' }),
}))

jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-url-names-org', () => ({ useUrlNamesOrg: () => true }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'pro' }, ready: true }),
  useCurrentOrg: () => ({ org: { $id: 'org-1', plan: 'pro' }, ready: true }),
}))
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
  useHostRole: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: {}, can: () => true, loaded: true }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  __esModule: true,
  useReleaseFlags: () => ({
    flags: new Proxy({}, { get: () => ({ released: true }) }),
    ready: true,
    isStaff: false,
  }),
}))
jest.mock('../components/feature-gate.component', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['catalog'],
}))
jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'acme-site',
}))
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => null,
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock(
  '../components/console-media-picker-provider.component',
  () => passthrough,
)

/* The pieces of the real header that need a DOM but not a test. */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  Container: ({ children }: any) => <div>{children}</div>,
  MdiIcon: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx/components/background-image.component', () => ({
  __esModule: true,
  BackgroundImageComponent: ({ children }: any) => <header>{children}</header>,
}))
jest.mock('../components/docs-help-tip.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/quota-warnings-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/search-discouraged-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/footer.component', () => ({
  __esModule: true,
  default: () => null,
}))

/*
 * The trail, rendered as a readable list rather than the real component.
 *
 * What is under test is WHICH crumbs reach it and in what order — the
 * component that draws them has its own tests — so this prints each crumb's
 * text and its href, and nothing else.
 */
jest.mock('../components/breadcrumbs.component', () => ({
  __esModule: true,
  default: ({ items }: any) => (
    <ol aria-label="trail">
      {(items ?? []).map((item: any, index: number) => (
        <li
          key={index}
          // The real component renders its LAST crumb as text whatever it is
          // handed — the level the reader is on is a label, not a way to get
          // there. A mock that linked it would let a trail pass here that the
          // console would not draw.
          data-href={index === items.length - 1 ? '' : (item.href ?? '')}
        >
          {typeof item.children === 'string' ? item.children : ''}
        </li>
      ))}
    </ol>
  ),
}))

import DashboardLayout from '../components/layouts/dashboard.layout'

/** The page header, by its landmark role — the bar the title sits in. */
const pageHeader = () => screen.getByRole('banner')

/** The heading text, with the icon and help affordance stripped by the mocks. */
const heading = () =>
  screen.getByRole('heading', { level: 1 }).textContent?.trim()

/**
 * The trail as `text` / `text→href` pairs, in order.
 *
 * The home crumb is an icon with no text of its own, so it is dropped here
 * rather than asserted as an empty string in every expectation.
 */
const trail = () =>
  Array.from(screen.getByLabelText('trail').querySelectorAll('li'))
    .filter((item) => item.textContent)
    .map((item) => {
      const href = item.getAttribute('data-href')
      return href ? `${item.textContent}→${href}` : item.textContent
    })

/** A detail surface that has loaded its record and says so. */
function RecordSurface(props: { name?: string }) {
  return (
    <>
      <PageHeaderRecord title={props.name} />
      <PageHeaderActions>
        <button type="button">{'Edit in besigner'}</button>
      </PageHeaderActions>
      <p>{'the record body'}</p>
    </>
  )
}

/** The list this surface's detail view is reached from. */
function ListSurface() {
  return <p>{'the list body'}</p>
}

/** The route's own chrome: a site, then the surface the record sits under. */
const routeCrumbs = [
  { children: 'Aglyn Marketing Website', href: '/acme/hosts/acme-site' },
  { children: 'Forms', href: '/acme/hosts/acme-site/forms' },
]

function renderLayout(body: ReactNode, header?: Record<string, unknown>) {
  return render(
    (
      <DashboardLayout
        header={header ?? { children: 'Forms' }}
        breadcrumbItems={routeCrumbs}
      >
        {body}
      </DashboardLayout>
    ) as any,
  )
}

describe('a detail surface names its record in a header it does not own', () => {
  it('CONTROL: the heading is the record, and the trail ends on it', () => {
    renderLayout(<RecordSurface name="Test Form" />)
    expect(heading()).toBe('Test Form')
    // Every level the route drew is still there and still clickable — the
    // record is ADDED to the trail, never substituted for it.
    expect(trail()).toEqual([
      'Aglyn Marketing Website→/acme/hosts/acme-site',
      'Forms→/acme/hosts/acme-site/forms',
      'Test Form',
    ])
    expect(screen.getByText('the record body')).toBeTruthy()
  })

  it('leaves a surface that publishes no record exactly as the route wrote it', () => {
    // The other half of the control: the same layout, the same route crumbs,
    // and a body that is a LIST. A seam that overwrote the heading
    // unconditionally would pass the assertion above and break every list in
    // the console.
    renderLayout(<ListSurface />)
    expect(heading()).toBe('Forms')
    // `Forms` is the end of the trail here and so renders as a label, which
    // is the same rule that makes it a LINK in the test above: what changes
    // is whether a record stands below it.
    expect(trail()).toEqual([
      'Aglyn Marketing Website→/acme/hosts/acme-site',
      'Forms',
    ])
  })

  it('holds the route heading until the record has a name', () => {
    // Mid-load: the document has not arrived, so there is no name to show.
    // The surface's own heading is a better answer than an empty one, and a
    // half-loaded value would flash the heading through a wrong string.
    renderLayout(<RecordSurface name={undefined} />)
    expect(heading()).toBe('Forms')
    expect(trail()).toHaveLength(2)
  })

  it('drops the section suffix once the heading is a record', () => {
    // `secondary` names the SECTION of a hub, which reads `Emails /
    // Templates`. Kept beside a record's name it would render
    // `Welcome email / Templates` — the record followed by where it came
    // from, which is what the breadcrumb is for.
    renderLayout(<RecordSurface name="Welcome email" />, {
      children: 'Emails',
      secondary: 'Templates',
    })
    expect(heading()).toBe('Welcome email')
    expect(heading()).not.toContain('Templates')
  })

  it('clears the record when the detail surface gives way to a list', () => {
    const { rerender } = renderLayout(<RecordSurface name="Test Form" />)
    expect(heading()).toBe('Test Form')

    rerender(
      (
        <DashboardLayout
          header={{ children: 'Forms' }}
          breadcrumbItems={routeCrumbs}
        >
          <ListSurface />
        </DashboardLayout>
      ) as any,
    )
    // The list must not be left wearing the last form's name. The publisher
    // unmounts and its cleanup runs in the same commit the list mounts in.
    expect(heading()).toBe('Forms')
    expect(trail()).toHaveLength(2)
  })

  it('puts the record name and the action in one header', () => {
    renderLayout(<RecordSurface name="Test Form" />)
    // The two seams compose: the heading is the record's and the action sits
    // beside it, which is the whole arrangement the floating strip between
    // the header and the cards was standing in for.
    expect(heading()).toBe('Test Form')
    expect(
      within(pageHeader()).getByRole('button', { name: 'Edit in besigner' }),
    ).toBeTruthy()
  })

  it('is inert with no layout above it', () => {
    // A surface mounted outside the console shell — a test harness, a
    // storybook — publishes into nothing rather than throwing.
    render((<RecordSurface name="Test Form" />) as any)
    expect(screen.getByText('the record body')).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */

import HostPluginPage from '../app/(app)/[orgSlug]/hosts/[host]/[...pluginSlug]/page'

/** The record the mounted surface has loaded, or none for a list route. */
let mockRecordName: string | undefined

/**
 * A plugin surface that names its record the way a real detail surface does.
 *
 * The route and the layout are BOTH under test here, and neither is the
 * behavior alone: the route decides which crumbs above the record carry an
 * href, and it can only be right about that if something below it actually
 * appends one.
 */
function MockPluginPage(props: ConsolePluginPageProps) {
  return (
    <>
      <PageHeaderRecord title={mockRecordName} />
      <div>{`plugin body ${(props.segments ?? []).join('/')}`}</div>
    </>
  )
}

async function mountAt(segments: string[], record?: string) {
  mockSegments = segments
  mockRecordName = record
  render(<HostPluginPage />)
  await waitFor(() => expect(screen.queryByLabelText('trail')).toBeTruthy())
}

describe('the route leaves every level above the record clickable', () => {
  beforeEach(() => {
    mockRecordName = undefined
    registerConsoleExtension({
      pluginId: 'catalog',
      displayName: 'Catalog',
      navItems: [
        {
          label: 'Forms',
          href: '/forms',
          navTabId: 'nav-tab-forms',
          header: { title: 'Forms' },
          Component: MockPluginPage,
          ownsSubtree: true,
        },
        {
          label: 'Emails',
          href: '/emails',
          navTabId: 'nav-tab-emails',
          header: { title: 'Emails' },
          Component: MockPluginPage,
          sections: [
            { id: 'templates', label: 'Templates' },
            { id: 'messages', label: 'Messages' },
          ],
        },
      ],
    })
  })

  afterEach(() => {
    unregisterConsoleExtension('catalog')
  })

  it('CONTROL: the surface links back from a record of the subtree it owns', async () => {
    await mountAt(['forms', 'form-abc'], 'Test Form')
    // The list is where a reader on one form most wants to get back to, and
    // it is no longer the end of the trail — so it must not read as one.
    expect(trail()).toEqual(['Forms→/acme/hosts/acme-site/forms', 'Test Form'])
  })

  it('leaves the surface unlinked on its own list', async () => {
    await mountAt(['forms'])
    // Nothing stands below it, so it is the page the reader is on. A link to
    // here is a link to nowhere.
    expect(trail()).toEqual(['Forms'])
  })

  it('links the section too when a record is open inside it', async () => {
    await mountAt(['emails', 'templates', 'tpl-1'], 'Welcome email')
    expect(trail()).toEqual([
      'Emails→/acme/hosts/acme-site/emails',
      'Templates→/acme/hosts/acme-site/emails/templates',
      'Welcome email',
    ])
  })

  it('leaves the section unlinked on the section itself', async () => {
    await mountAt(['emails', 'templates'])
    expect(trail()).toEqual([
      'Emails→/acme/hosts/acme-site/emails',
      'Templates',
    ])
  })

  it('heads a plugin record route with the record, not the surface', async () => {
    await mountAt(['emails', 'templates', 'tpl-1'], 'Welcome email')
    // The whole arc, end to end: the URL names a template, the surface reads
    // it, and the chrome the shell drew says so.
    expect(heading()).toBe('Welcome email')
  })
})
