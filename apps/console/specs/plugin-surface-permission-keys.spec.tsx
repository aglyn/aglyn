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
 * The keys the shipping plugin surfaces declare, driven THROUGH THE ROUTE.
 *
 * `plugin-surface-permission-gate.spec.tsx` proves the shell's gate as a
 * mechanism, against a demo registration. This file asks the narrower
 * question the mechanism was built for: with the shapes the commerce and
 * email packages actually register, does the right person reach the right
 * surface? A gate that works and a declaration that is wrong produce a
 * console nobody can use, and neither spec alone would notice.
 *
 * ## The pairing, and why it is two files
 *
 * `libs/plugins/commerce/src/lib/plugin.spec.ts` and its email counterpart
 * assert the literal values on the real registrations — that `/pos` requires
 * `managePos`, that `/products` requires nothing, that the email extension
 * requires `data.manage`. They run in their own packages, where those
 * modules are local. This file mounts the console route against those same
 * shapes and the REAL permission resolvers, so what is proved here is that
 * the shell does the intended thing with them. The declaration halves and
 * this half are each other's other half; changing a key without changing
 * both is what turns one of them red.
 *
 * ## What is real here
 *
 * Only the member read is faked. `useOrgPermissions`, `resolveOrgPermissions`
 * and `resolveRolePermissions` are the shipped resolvers, and `managePos` is
 * registered below with the defaults `COMMERCE_PERMISSIONS` really carries —
 * `editor: true`, not the `editor: false` a spec would reach for to make a
 * refusal easy. Every refusal is paired with a control that drives the SAME
 * member document to a render, because a permission module answering "no" to
 * everybody would satisfy every deny assertion in this file while describing
 * a console that has locked out its paying customers.
 */

import {
  registerPluginPermissions,
  type ConsolePluginPageProps,
} from '@aglyn/aglyn'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'
const HOST_ID = 'host-1'

/**
 * The declarations under test, named once.
 *
 * Written as the literals the plugin packages register rather than imported
 * from them: pulling `libs/plugins/commerce` into the console's module graph
 * drags the whole storefront component set through a jsdom transform for a
 * two-field assertion. The package specs are what hold these honest.
 */
const POS_KEY = 'managePos'
const EMAIL_KEY = 'data.manage'

/** The member document the read answers with, per test. */
let mockMember: Record<string, unknown> | undefined
/** Set to hold the member read open — the loading window. */
let mockMemberReadHangs: boolean
/** Which registered surface the route is resolving. */
let mockSurface: 'products' | 'pos' | 'emails'
/** Cleared per test so a declaration can be REMOVED to prove vacuity. */
let mockDeclarationsEnabled: boolean
/** The key the POS nav item declares — overridden to test an UNKNOWN one. */
let mockPosKey: string
/** Counted per mount, so "did not render" is a positive assertion. */
let pageRenders: number

function MockPluginPage(_props: ConsolePluginPageProps) {
  pageRenders += 1
  return <div>{'plugin-page-body'}</div>
}

/**
 * The commerce and email registrations, in the shape their `plugin.ts` files
 * build them: commerce is ONE extension carrying two nav items with
 * different answers, email is one extension whose single surface carries the
 * requirement.
 *
 * Built on CALL, not at module scope. `jest.mock` factories are hoisted above
 * these declarations, so the mocked module is required while `POS_KEY` is
 * still in its temporal dead zone — an eagerly-evaluated table here fails the
 * suite at import with a message about initialization order rather than
 * anything to do with permissions.
 */
const surfaceUnderTest = () =>
  ({
    products: {
      extension: { pluginId: 'commerce', displayName: 'Commerce' },
      navItem: {
        label: 'Products',
        href: '/products',
        header: { title: 'Products' },
      },
    },
    pos: {
      extension: { pluginId: 'commerce', displayName: 'Commerce' },
      navItem: {
        label: 'POS',
        href: '/pos',
        permission: mockPosKey,
        header: { title: 'Point of Sale' },
      },
    },
    emails: {
      extension: {
        pluginId: 'email',
        displayName: 'Email',
        permission: EMAIL_KEY,
      },
      navItem: {
        label: 'Emails',
        href: '/emails',
        header: { title: 'Emails' },
      },
    },
  })[mockSurface]

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  // The resolvers stay real — they are the verdict under test. Only the
  // registry lookup is replaced, so the route can resolve a surface without
  // the plugin packages being imported into the console.
  resolveConsolePluginPage: () => {
    const surface = surfaceUnderTest()
    const strip = (value: Record<string, unknown>) =>
      mockDeclarationsEnabled ? value : { ...value, permission: undefined }
    return {
      extension: strip({ ...surface.extension }),
      navItem: {
        ...strip({ ...surface.navItem }),
        Component: MockPluginPage,
      },
      segments: [],
    }
  },
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
  getDoc: async (_ref: { path: string }) => {
    if (mockMemberReadHangs) return new Promise(() => undefined)
    return {
      exists: () => mockMember !== undefined,
      data: () => mockMember,
    }
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
  useParams: () => ({ pluginSlug: [mockSurface] }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => `/acme/hosts/acme-site/${mockSurface}`,
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
  default: () => ({ org: { $id: ORG_ID, plan: 'pro' }, orgId: ORG_ID, ready: true }),
  useCurrentOrg: () => ({
    org: { $id: ORG_ID, plan: 'pro' },
    orgId: ORG_ID,
    ready: true,
  }),
}))
/**
 * SITE ADMIN throughout, deliberately.
 *
 * The host role is the other axis, and holding it at its most permissive
 * value is what makes every refusal below attributable to the org key alone.
 * It also states the case the POS narrowing is really about: somebody who
 * runs this site completely, and still may not open the till.
 */
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
  useHostRole: () => ({ hostRole: 'admin', canPublish: true, loaded: true }),
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['commerce', 'email'],
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
  /*
   * The REAL defaults from `COMMERCE_PERMISSIONS`, not convenient ones.
   *
   * `editor: true` is the value that makes this spec hard: the editor tier
   * holds `managePos` by default, so a refusal for an editor can only come
   * from an explicit revocation, and a spec that quietly flipped this to
   * `false` would be proving the tier table rather than the gate.
   */
  registerPluginPermissions([
    {
      key: POS_KEY,
      pluginId: 'commerce',
      label: 'Use the point of sale',
      defaults: { admin: true, editor: true, viewer: false },
    },
  ])
})

beforeEach(() => {
  mockMember = { role: 'admin' }
  mockMemberReadHangs = false
  mockSurface = 'pos'
  mockDeclarationsEnabled = true
  mockPosKey = POS_KEY
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
const body = () => screen.queryByText('plugin-page-body')

describe('the POS register is narrowed without gating the catalog beside it', () => {
  /**
   * The whole reason the key sits on the nav item.
   *
   * Commerce registers Products and POS from ONE extension. A requirement on
   * the extension would apply to both, so the merchandiser who keeps the
   * catalog would be refused it for lacking a point-of-sale permission. Each
   * pair below drives the SAME member document at both surfaces.
   */
  const posRefusedProductsAdmitted = async (
    member: Record<string, unknown>,
  ) => {
    mockMember = member
    mockSurface = 'pos'
    const pos = mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    // Not merely hidden — never invoked. A register that mounted and then hid
    // itself has already opened its product, location, register and
    // reservation listeners, and the last of those names checked-in guests.
    expect(pageRenders).toBe(0)
    pos.unmount()

    pageRenders = 0
    mockSurface = 'products'
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
    expect(pageRenders).toBe(1)
  }

  it('refuses an org VIEWER the till and still hands them Products', async () => {
    await posRefusedProductsAdmitted({ role: 'viewer' })
  })

  it('refuses an ADMIN whose `managePos` was revoked individually', async () => {
    /*
     * The strongest form of the claim: one member document, one tier, and
     * the ONLY difference between the two surfaces is the declared key. A
     * role-shaped gate would admit this member to both.
     */
    await posRefusedProductsAdmitted({
      role: 'admin',
      permissions: { [POS_KEY]: false },
    })
  })

  it('CONTROL: an EDITOR holds the key by default and reaches the till', async () => {
    // The anti-vacuity pair for both cases above. The editor tier's default
    // for `managePos` is true, so this proves the gate can say yes to a
    // non-admin — a module refusing everybody would fail here.
    mockMember = { role: 'editor' }
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
  })

  it('CONTROL: an ADMIN reaches the till', async () => {
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
  })

  it('refuses the till when the key is in NEITHER vocabulary', async () => {
    /*
     * `managePos` reaches the resolved map only because commerce's
     * `registerPluginPermissions(COMMERCE_PERMISSIONS)` ran. That call sits
     * at plugin module scope, so a bundle that failed to load, a registry
     * refusal over a key another plugin already owns, or a typo here all
     * produce the same thing: a declared requirement that no vocabulary can
     * answer.
     *
     * The reader below is an ADMIN, so nothing but the unanswerable key can
     * be doing the refusing. Reading the absent value as permitted would
     * make a register whose permission never registered indistinguishable
     * from one deliberately left open to everybody.
     */
    mockPosKey = 'managePosx'
    mockMember = { role: 'admin' }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('CONTROL: the same refused viewer renders POS once the key is undeclared', async () => {
    /*
     * The load-bearing control. It changes only the DECLARATION and drives
     * the identical member document to a render, so the refusals above
     * cannot be explained by a permission module that answers no to
     * everybody, or by POS being unreachable in this harness for some
     * unrelated reason.
     */
    mockMember = { role: 'viewer' }
    mockDeclarationsEnabled = false
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
  })
})

describe('the email console is gated on the data key', () => {
  beforeEach(() => {
    mockSurface = 'emails'
  })

  it('refuses an org VIEWER, and the surface never mounts', async () => {
    /*
     * The population this key exists to refuse. The audiences section reads
     * `orgs/{orgId}/lists/{listId}/members` — enrolled contacts and the
     * consent basis recording why each may be mailed — and the rules gate
     * that read on `isOrgWideMember()` with NO role condition. So an org-wide
     * viewer reads every audience the organization has, and this is the first
     * thing that asks whether they may.
     */
    mockMember = { role: 'viewer', allHosts: true }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
    expect(body()).toBeNull()
  })

  it('CONTROL: admits an org EDITOR — the tier the list gate accepts', async () => {
    // `server-list-gate.ts` accepts a list write from owner, admin and
    // editor. `data.manage` defaults true on exactly those, so the console
    // offers the surface to the population the route already answers to.
    mockMember = { role: 'editor', allHosts: true }
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
  })

  it('CONTROL: admits an org ADMIN', async () => {
    mockMember = { role: 'admin', allHosts: true }
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
  })

  it('reads the resolved MAP, not the role — a revoked key refuses an editor', async () => {
    mockMember = {
      role: 'editor',
      allHosts: true,
      permissions: { [EMAIL_KEY]: false },
    }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('CONTROL: the same refused viewer renders once the key is undeclared', async () => {
    // Anti-vacuity for this surface, on its own declaration.
    mockMember = { role: 'viewer', allHosts: true }
    mockDeclarationsEnabled = false
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
  })

  it('names the surface it is refusing', async () => {
    mockMember = { role: 'viewer', allHosts: true }
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(screen.getByText(/permission to open Emails/i)).toBeTruthy()
  })
})

/**
 * THE SITE COLLABORATOR, decided per surface rather than inherited.
 *
 * A collaborator is a real `orgs/{orgId}/members/{uid}` document with
 * `allHosts: false` and a `hostAccess` map, so every org-level role check has
 * always admitted them. Contacts decided they reach the CRM scoped, because
 * the listener, the rules and the consent facets all narrow what they see.
 *
 * THE EMAIL ANSWER IS THE SAME, FOR A DIFFERENT REASON. Here the org-shared
 * half is already refused beneath the console: `orgs/{orgId}/lists` and its
 * members are `isOrgWideMember()` reads, which a scoped collaborator is not,
 * so the audiences section is empty for them no matter what this gate says.
 * What remains is this site's own messages, templates and sending identities,
 * which are theirs to work on. Refusing the surface would take that away to
 * close nothing.
 */
describe('a site collaborator on the email console', () => {
  /** As `grantHostAccess` writes one: on the roster, scoped to one site. */
  const collaborator = (role: string, extra: Record<string, unknown> = {}) => ({
    role,
    allHosts: false,
    hostAccess: { [HOST_ID]: 'editor' },
    ...extra,
  })

  beforeEach(() => {
    mockSurface = 'emails'
  })

  it('REACHES the surface when their org role carries the key', async () => {
    mockMember = collaborator('editor')
    mountPage()
    await waitFor(() => expect(body()).toBeTruthy())
    expect(refusal()).toBeNull()
  })

  it('is refused when their org role does not', async () => {
    // The default `grantHostAccess` writes: a viewer scoped to one site.
    mockMember = collaborator('viewer')
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })

  it('can have the key taken off them individually', async () => {
    mockMember = collaborator('editor', {
      permissions: { [EMAIL_KEY]: false },
    })
    mountPage()
    await waitFor(() => expect(refusal()).toBeTruthy())
    expect(pageRenders).toBe(0)
  })
})

describe('neither surface renders from an unsettled read', () => {
  it.each(['pos', 'emails'] as const)(
    '%s renders neither the surface nor a refusal while the read is in flight',
    async (surface) => {
      /*
       * The permission map is the permissive ADMIN map until the member
       * document lands, so "not yet known" and "granted" are the same value
       * in it. Rendering from that window is the leak; refusing from it
       * accuses a legitimate admin on every navigation. Neither, until it
       * settles.
       */
      mockSurface = surface
      mockMemberReadHangs = true
      mockMember = { role: 'viewer' }
      mountPage()
      await waitFor(() => expect(pageRenders).toBe(0))
      expect(refusal()).toBeNull()
      expect(body()).toBeNull()
    },
  )
})
