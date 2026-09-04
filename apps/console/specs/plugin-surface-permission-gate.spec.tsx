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
 * The shell decides WHO may open a plugin surface, not the plugin.
 *
 * `ConsoleExtension` gained an entitlement gate the shell applies, and that
 * gate answers what the ORGANIZATION bought. Nothing answered who among its
 * members may read the surface: a nav item's `navTabId` is a release flag,
 * and `FeatureGate` reads it as `released || isStaff`, so it says whether a
 * feature has shipped and nothing about standing. An extension could gate
 * itself on the `permissions` prop the route hands down — and a prop is
 * advice, which is the same footing the entitlement half was on before the
 * shell took it over.
 *
 * Contacts is the surface that made it urgent. The CRM is org-shared people
 * data reachable from every site in an organization, and a site collaborator
 * is a real `orgs/{orgId}/members/{uid}` document, so "is on the roster" was
 * the only thing between an agency's client and the page.
 *
 * ## What is real here, and why that is the point
 *
 * The member read is faked; NOTHING ELSE IS. `useOrgPermissions` is the
 * shipped hook, `resolveOrgPermissions` and `resolveRolePermissions` are the
 * shipped resolvers, and the gate under test resolves through both. So each
 * case below states a MEMBER DOCUMENT and asserts what the route does with
 * it.
 *
 * That is what makes the refusals mean anything. A spec that stubbed the
 * permission map with hand-written booleans would pass every deny assertion
 * against a module that answers "no" to everybody — a gate that locks out
 * the paying customers is not the gate being asked for. Every refusal below
 * is therefore paired with a control that drives the SAME member document,
 * or the same declaration, to a render.
 */

import {
  registerPluginPermissions,
  type ConsolePluginPageProps,
} from '@aglyn/aglyn'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'
const HOST_ID = 'host-1'

/** The member document the read answers with, per test. */
let mockMember: Record<string, unknown> | undefined
/** A custom role doc at `orgs/{org}/roles/{roleId}`, when one is assigned. */
let mockCustomRole: Record<string, unknown> | undefined
/** Set to hold the member read open — the loading window. */
let mockMemberReadHangs: boolean
/** What the registered extension and its nav item declare. */
let mockExtensionPermission: string | undefined
let mockNavItemPermission: string | undefined
/** Anything else the extension puts on its own registration. */
let mockExtensionExtras: Record<string, unknown>
/** The org billing doc, for the case where both gates could fire. */
let mockOrg: Record<string, unknown> | undefined
let mockFeatureFlag: string | undefined
/** Counted per mount, so "did not render" is a positive assertion. */
let pageRenders: number

function MockPluginPage(_props: ConsolePluginPageProps) {
  pageRenders += 1
  return <div>{'plugin-page-body'}</div>
}

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  // The permission RESOLVERS stay real — they are the verdict under test.
  // Only the registry lookup is replaced, so a case can register a surface
  // without dragging a plugin package into the console's module graph.
  resolveConsolePluginPage: () => ({
    extension: {
      pluginId: 'demo',
      displayName: 'Contacts',
      featureFlag: mockFeatureFlag,
      permission: mockExtensionPermission,
      ...mockExtensionExtras,
    },
    navItem: {
      label: 'Contacts',
      href: '/contacts',
      permission: mockNavItemPermission,
      header: { title: 'Contacts' },
      Component: MockPluginPage,
    },
    segments: [],
  }),
}))

/**
 * STABLE IDENTITY. `useFirestore` sits in the member read's effect deps, and
 * a factory returning a fresh `{}` per call re-renders forever — a microtask
 * loop that hangs the suite instead of failing it.
 */
const FIRESTORE = {}

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getDoc: async (ref: { path: string }) => {
    if (mockMemberReadHangs) return new Promise(() => undefined)
    const data = ref.path.includes('/roles/') ? mockCustomRole : mockMember
    return { exists: () => data !== undefined, data: () => data }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
  useRemoteConfig: () => ({ defaultConfig: {} }),
  useUser: () => ({
    data: {
      uid: 'u1',
      getIdToken: async () => 'tok',
      // Never staff. The release-flag bypass would render every case here.
      getIdTokenResult: async () => ({ claims: {} }),
    },
  }),
}))

jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => true,
  getValue: () => ({ asString: () => '' }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginSlug: ['contacts'] }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/acme/hosts/acme-site/contacts',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

/**
 * The org scope, answered. `useOrgPermissions` needs an `orgId` to attempt
 * the member read at all — with `currentOrg` undefined it short-circuits to
 * the fresh-account OWNER branch and every case here would render.
 */
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ currentOrg: { $id: ORG_ID }, loading: false }),
  useOrgScope: () => ({ currentOrg: { $id: ORG_ID }, loading: false }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-url-names-org', () => ({ useUrlNamesOrg: () => true }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: ORG_ID, ready: true }),
  useCurrentOrg: () => ({ org: mockOrg, orgId: ORG_ID, ready: true }),
}))
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
  useHostRole: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['demo'],
}))
jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostId: () => HOST_ID,
  useHostSubdomain: () => 'acme-site',
}))

/** Chrome only — none of it sits between the verdict and the render. */
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/console-media-picker-provider.component', () => passthrough)
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => null,
}))

import HostPluginPage from '../app/(app)/[orgSlug]/hosts/[host]/[...pluginSlug]/page'
import { ReleaseFlagsProvider } from '../hooks/use-release-flags'

beforeAll(() => {
  // The OTHER permission vocabulary (AGL-2474). Plugin-declared keys are
  // camelCase and live in the resolved map, never in the dotted catalog, and
  // the gate has to look each key up in the space it belongs to.
  registerPluginPermissions([
    {
      key: 'managePos',
      pluginId: 'commerce',
      label: 'Use the point of sale',
      defaults: { admin: true, editor: false, viewer: false },
    },
  ])
})

beforeEach(() => {
  mockMember = { role: 'admin' }
  mockCustomRole = undefined
  mockMemberReadHangs = false
  mockExtensionPermission = 'data.manage'
  mockNavItemPermission = undefined
  mockExtensionExtras = {}
  mockOrg = { $id: ORG_ID, plan: 'pro' }
  mockFeatureFlag = undefined
  pageRenders = 0
})

const mountPage = () =>
  render(
    <ReleaseFlagsProvider>
      <HostPluginPage />
    </ReleaseFlagsProvider>,
  )

/** The shell's refusal, by the words it must say. */
const refusal = () => screen.queryByText(/don't have permission to open/i)
/** The entitlement half's refusal, which must not be what an unpermitted reader gets. */
const upgradeNotice = () =>
  screen.queryByText(/not included in your current plan/i)

const body = () => screen.queryByText('plugin-page-body')

/** Wait for the member read to settle before judging an absence. */
const settled = () =>
  waitFor(() => expect(refusal() !== null || body() !== null).toBe(true))

describe('a plugin surface behind a declared permission', () => {
  it('refuses an org VIEWER, and the surface never mounts', async () => {
    mockMember = { role: 'viewer' }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    // Not merely hidden — never invoked. A surface that mounted and then hid
    // itself has already run its effects and opened its listeners.
    expect(pageRenders).toBe(0)
    expect(body()).toBeNull()
  })

  it('CONTROL: admits an org ADMIN', async () => {
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
  })

  it('CONTROL: admits an org EDITOR — the tier the key defaults on', async () => {
    mockMember = { role: 'editor' }
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
  })

  it('CONTROL: a surface declaring nothing renders for the SAME viewer', async () => {
    /*
     * Anti-vacuity, and the load-bearing control in this file. Every refusal
     * above is asserted against a member document; this drives that same
     * document to a render by changing only the DECLARATION. Without it the
     * refusals are equally consistent with a permission module that answers
     * no to everybody, which is the failure that locks out paying customers
     * rather than closing a hole.
     */
    mockMember = { role: 'viewer' }
    mockExtensionPermission = undefined
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
  })

  it('reads the resolved MAP, not the role — a revoked key refuses an editor', async () => {
    // The per-member override is what custom roles are sold on. An editor
    // holds `data.manage` by tier default, so a gate that stopped at the
    // role would admit this member and the override would govern nothing.
    mockMember = { role: 'editor', permissions: { 'data.manage': false } }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('CONTROL: the same editor without the override is admitted', async () => {
    mockMember = { role: 'editor', permissions: {} }
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
  })

  it('honors a CUSTOM ROLE that revokes the key', async () => {
    mockMember = { role: 'editor', roleId: 'role-1' }
    mockCustomRole = { permissions: { 'data.manage': false } }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('renders neither the surface nor a refusal while the read is in flight', async () => {
    /*
     * The permission map is the permissive ADMIN map until the member
     * document lands, so "not yet known" and "granted" are the same value in
     * it. Refusing from that window accuses a legitimate admin on every
     * navigation; rendering from it is the leak. Neither, until it settles.
     */
    mockMemberReadHangs = true
    mockMember = { role: 'viewer' }
    mountPage()
    await waitFor(() => expect(pageRenders).toBe(0))
    expect(refusal()).toBeNull()
    expect(body()).toBeNull()
  })
})

describe('the two permission vocabularies are looked up separately', () => {
  it('answers a PLUGIN-declared key from the resolved map', async () => {
    // `managePos` is camelCase and exists nowhere in the dotted catalog, so
    // a gate that only consulted `can()` would find nothing and — reading a
    // missing key as absent-therefore-allowed — admit everybody.
    mockExtensionPermission = 'managePos'
    mockMember = { role: 'editor' }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('CONTROL: the same key admits the tier that holds it', async () => {
    mockExtensionPermission = 'managePos'
    mockMember = { role: 'admin' }
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
  })

  it('REFUSES a key in neither vocabulary rather than passing it', async () => {
    /*
     * A misspelled requirement, or one whose `registerPluginPermissions`
     * never ran. Answering "granted" would make a broken gate
     * indistinguishable from no gate at all — and the member document here
     * is an ADMIN, so nothing but the unknown key can be doing the refusing.
     */
    mockExtensionPermission = 'manageContactz'
    mockMember = { role: 'admin' }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })
})

describe('a nav item narrows its extension, and never widens it', () => {
  it('applies the NAV ITEM’s own key when the extension declares none', async () => {
    mockExtensionPermission = undefined
    mockNavItemPermission = 'data.manage'
    mockMember = { role: 'viewer' }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('requires BOTH when both are declared', async () => {
    // An editor holds `data.manage` and does NOT hold `managePos`. An OR
    // would admit them; the surface requires every declared key.
    mockExtensionPermission = 'data.manage'
    mockNavItemPermission = 'managePos'
    mockMember = { role: 'editor' }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('CONTROL: admits the member who holds both', async () => {
    mockExtensionPermission = 'data.manage'
    mockNavItemPermission = 'managePos'
    mockMember = { role: 'admin' }
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
  })
})

describe('an extension declares a requirement; it cannot answer one', () => {
  it('cannot talk its way past the gate, however it is decorated', async () => {
    /*
     * The registration is the one thing an extension controls, so anything
     * on it that could reach the verdict would be the bypass this gate
     * exists to close. The extension below claims standing every way its own
     * registration allows, against a viewer.
     */
    mockMember = { role: 'viewer' }
    mockExtensionExtras = {
      granted: true,
      permitted: true,
      permissions: { 'data.manage': true, managePos: true },
      permissionVerdict: 'granted',
    }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
    expect(body()).toBeNull()
  })

  it('refuses on standing before it offers an upgrade path', async () => {
    /*
     * Both gates would fire: a free org that does not hold `redirects`, read
     * by a viewer who does not hold `data.manage`. The plan is not what is
     * standing between this reader and the page, and pointing them at
     * Billing invites an organization to buy a feature that would change
     * nothing for the person asking.
     */
    mockFeatureFlag = 'redirects'
    mockOrg = { $id: ORG_ID, plan: 'free' }
    mockMember = { role: 'viewer' }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(upgradeNotice()).toBeNull()
    expect(screen.queryByRole('button', { name: /view plans/i })).toBeNull()
    expect(pageRenders).toBe(0)
  })

  it('CONTROL: a PERMITTED reader on an unentitled org still gets the upgrade path', async () => {
    // The entitlement half is untouched — proof that the case above refused
    // on standing rather than simply swallowing every refusal.
    mockFeatureFlag = 'redirects'
    mockOrg = { $id: ORG_ID, plan: 'free' }
    mockMember = { role: 'admin' }
    mountPage()
    await waitFor(() => expect(upgradeNotice()).toBeTruthy())
    expect(refusal()).toBeNull()
    expect(pageRenders).toBe(0)
  })
})

/**
 * THE SITE COLLABORATOR, decided rather than inherited.
 *
 * `grantHostAccess` writes a real `orgs/{orgId}/members/{uid}` document with
 * `allHosts: false` and a `hostAccess` map, so a contractor invited to one
 * microsite is on the roster and every org-level role check has always
 * admitted them. On the Contacts surface that reader may be one client of an
 * agency looking at a CRM the agency shares across its whole book.
 *
 * THE DECISION IS THAT THEY REACH IT, SCOPED. The scoping exists and is
 * enforced twice below the console: the page's listener filters on
 * `visibleTo` with `array-contains-any`, the Firestore rules prove the same
 * predicate per document with `hasAny` — an unfiltered list is
 * permission-denied rather than quietly returning the collection — and every
 * field the page shows is read through the viewing group's own facet.
 * Refusing them outright would delete that capability rather than close a
 * hole.
 *
 * What the gate adds is that the question is now asked. A collaborator
 * reaches the surface on the same terms as anyone else: they must hold the
 * key, and it can be taken off them individually.
 */
describe('a site collaborator', () => {
  /** As `grantHostAccess` writes one: on the roster, scoped to one site. */
  const collaborator = (role: string, extra: Record<string, unknown> = {}) => ({
    role,
    allHosts: false,
    hostAccess: { [HOST_ID]: 'editor' },
    ...extra,
  })

  it('REACHES the surface when their org role carries the key', async () => {
    mockMember = collaborator('editor')
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
  })

  it('is refused when their org role does not', async () => {
    mockMember = collaborator('viewer')
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('can have the key taken off them individually', async () => {
    // The revocation an agency reaches for: this contractor, not the tier.
    mockMember = collaborator('editor', {
      permissions: { 'data.manage': false },
    })
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('matches the population the rules admit for contact writes', async () => {
    /*
     * `canWriteOrgData()` in `cloud/firebase-firestore.rules` is
     * `role in ['owner','admin','editor']`, and it is the ORG role field it
     * reads even for a scoped member. `data.manage` defaults true on exactly
     * those tiers, so the console gate and the rules agree on the built-in
     * roles by construction rather than by being kept in step by hand.
     */
    mockMember = collaborator('owner')
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
  })
})

describe('the shell asks the question at all', () => {
  it('names the surface it is refusing', async () => {
    mockMember = { role: 'viewer' }
    mountPage()
    await settled()
    expect(screen.getByText(/permission to open Contacts/i)).toBeTruthy()
  })
})
