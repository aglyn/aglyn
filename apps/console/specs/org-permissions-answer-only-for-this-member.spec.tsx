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

/*==========================================
 * `loaded` MEANS "THIS MEMBER, IN THIS ORG, HAS ANSWERED" (AGL-3337).
 *
 * An owner opening a Sequences deep link on a cold load was told they had
 * no permission to open it, with the Sequences tab gone from the org strip,
 * until the page flipped to the real surface on its own. The permission
 * provider had published `loaded: true` for a question nobody had asked
 * yet: signed in, memberships not yet listened for, so "no org" — and a
 * reader with no org acts as an owner whose plugin keys resolved at the
 * VIEWER tier. That answer then outlived the org that arrived after it, and
 * stood until the member read for that org landed.
 *
 * These specs drive the REAL `OrgScopeProvider` and `OrgPermissionsProvider`
 * through the emissions a cold load makes — auth restoring, the membership
 * listen's first (cache) snapshot, the member read in flight, the member
 * read landing — and record every verdict the gates render along the way.
 * Nothing stubs `loaded`: the only doubles are Firestore's reads and the
 * signed-in user, and each is driven by hand, one emission at a time.
 *==========================================*/

import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'

type Deferred = {
  path: string
  resolve: (data: Record<string, unknown> | undefined) => void
  reject: (error: unknown) => void
}

/** Every member read asked for, in order, each settled by the test. */
const mockMemberReads: Deferred[] = []
/** Every membership listen opened, in order. */
const mockListens: Array<{
  path: string
  next: (snapshot: unknown) => void
  closed: boolean
}> = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  limit: () => undefined,
  query: (ref: { path: string }) => ref,
  onSnapshot: (
    ref: { path: string },
    _options: unknown,
    next: (snapshot: unknown) => void,
  ) => {
    const listen = { path: ref.path, next, closed: false }
    mockListens.push(listen)
    return () => {
      listen.closed = true
    }
  },
  getDoc: (ref: { path: string }) => {
    // The slug index and the out-of-window membership lookup are not what
    // these specs are about; they stay unanswered so they cannot race.
    if (!ref.path.includes('/members/')) return new Promise(() => undefined)
    return new Promise((resolve, reject) => {
      mockMemberReads.push({
        path: ref.path,
        resolve: (data) =>
          resolve({
            exists: () => data !== undefined,
            data: () => data,
          }),
        reject,
      })
    })
  },
}))

jest.mock('firebase/auth', () => ({
  onIdTokenChanged: () => () => undefined,
}))

/**
 * The signed-in user as ONE store both providers read, so a sign-in lands
 * in both in the same render — the way the auth SDK's single emission does.
 */
const mockSession: {
  user: { uid: string } | null | undefined
  listeners: Set<() => void>
} = { user: undefined, listeners: new Set() }

jest.mock('@aglyn/tenant-feature-instance', () => {
  const { useSyncExternalStore } = jest.requireActual('react')
  const firestore = {}
  const auth = {}
  const subscribe = (listener: () => void) => {
    mockSession.listeners.add(listener)
    return () => mockSession.listeners.delete(listener)
  }
  return {
    __esModule: true,
    useFirestore: () => firestore,
    useAuth: () => auth,
    useUser: () => ({
      data: useSyncExternalStore(subscribe, () => mockSession.user),
    }),
    subscribeFirestoreSessionHeal: () => () => undefined,
  }
})

const mockRoute: { orgSlug: string | undefined; pathname: string } = {
  orgSlug: 'aglyn-org',
  pathname: '/aglyn-org/outreach/compliance',
}
jest.mock('next/navigation', () => ({
  useParams: () => (mockRoute.orgSlug ? { orgSlug: mockRoute.orgSlug } : {}),
  usePathname: () => mockRoute.pathname,
}))

import {
  registerPluginPermissions,
  type ConsoleOrgNavEntry,
} from '@aglyn/aglyn'
import useOrgPermissions, {
  OrgPermissionsProvider,
} from '../hooks/use-org-permissions'
import { OrgScopeProvider } from '../hooks/use-org-scope'
import { resolveExtensionPermission } from '../utils/extension-permission'
import { resolveOrgCrmAccess } from '../utils/org-crm-access'
import { orgPluginNavTabItems } from '../utils/org-plugin-surfaces'

/**
 * A surface shaped like Sequences: a plugin-declared permission only owners
 * and admins hold by default. Registered here rather than imported from the
 * plugin, which a console spec may not do.
 */
const PERMISSION = 'agl3337.use'
registerPluginPermissions([
  {
    key: PERMISSION,
    pluginId: 'agl3337',
    label: 'Use the gated surface',
    defaults: { admin: true, editor: false, viewer: false },
  },
])

const Page = (): null => null
const gated: ConsoleOrgNavEntry = {
  extension: {
    pluginId: 'agl3337',
    displayName: 'Gated',
    permission: PERMISSION,
  },
  navItem: {
    label: 'Gated',
    href: '/gated',
    navTabId: 'nav-tab-org-gated',
    Component: Page,
  },
}

/** What the page, the org strip and the org CRM rendered, render by render. */
interface Frame {
  page: string
  tab: 'live' | 'placeholder' | 'absent'
  crm: string
}
let frames: Frame[] = []

/** Renders every gate this provider feeds, and records what each one said. */
function Gates() {
  const { can, permissions, loaded, errored } = useOrgPermissions()
  const page = resolveExtensionPermission([PERMISSION], {
    can,
    permissions,
    loaded,
  })
  const [tab] = orgPluginNavTabItems('aglyn-org', [gated], {
    can,
    permissions,
    permissionsLoaded: loaded,
    org: undefined,
    orgReady: true,
  })
  const crm = resolveOrgCrmAccess({
    // Reach is its own read with its own gate; this spec is about the
    // permission half, so reach is held settled and org-wide.
    orgWide: true,
    reachReady: true,
    can,
    permissionsLoaded: loaded,
    permissionsErrored: errored,
  })
  frames.push({
    page,
    tab: !tab ? 'absent' : tab.disabled ? 'placeholder' : 'live',
    crm,
  })
  return <span>{`page:${page}`}</span>
}

function Console(props: { children?: ReactNode }) {
  return (
    <OrgScopeProvider>
      <OrgPermissionsProvider>{props.children ?? <Gates />}</OrgPermissionsProvider>
    </OrgScopeProvider>
  )
}

const membership = (id: string, slug: string) => ({
  id,
  data: () => ({ slug, orgName: slug, allHosts: true }),
})

/** Delivers one snapshot on the newest membership listen. */
function emitMemberships(
  docs: ReturnType<typeof membership>[],
  fromCache: boolean,
) {
  const listen = mockListens.filter((entry) => !entry.closed).at(-1)
  if (!listen) throw new Error('no membership listen is open')
  act(() =>
    listen.next({
      metadata: { fromCache },
      docChanges: () => docs.map(() => ({})),
      docs,
    }),
  )
}

function signIn(uid: string) {
  act(() => {
    mockSession.user = { uid }
    for (const listener of mockSession.listeners) listener()
  })
}

async function answerMemberRead(
  path: string,
  data: Record<string, unknown> | undefined,
) {
  const read = mockMemberReads.find((entry) => entry.path === path)
  if (!read) {
    throw new Error(
      `no member read for ${path}; asked: ${mockMemberReads
        .map((entry) => entry.path)
        .join(', ')}`,
    )
  }
  await act(async () => {
    read.resolve(data)
  })
}

const last = () => frames[frames.length - 1]
const seen = (key: keyof Frame) => new Set(frames.map((frame) => frame[key]))

beforeEach(() => {
  frames = []
  mockMemberReads.length = 0
  mockListens.length = 0
  mockSession.user = undefined
  mockSession.listeners.clear()
  mockRoute.orgSlug = 'aglyn-org'
  mockRoute.pathname = '/aglyn-org/outreach/compliance'
})

describe('a cold load of a gated org page (AGL-3337)', () => {
  it('REGRESSION: the owner is never refused and the tab never leaves, from sign-in to the member read', async () => {
    render(<Console />)
    signIn('owner-1')
    // The membership listen's first answer is the persistent cache's.
    emitMemberships([membership('org-1', 'aglyn-org')], true)
    expect(mockMemberReads.map((read) => read.path)).toEqual([
      'orgs/org-1/members/owner-1',
    ])

    // The member read is in flight, which on a slow session is seconds.
    // Before the fix this frame was `refused` with the tab gone: the
    // provider had already answered "no org, so an owner at the viewer tier".
    expect(last()).toEqual({ page: 'pending', tab: 'placeholder', crm: 'pending' })

    await answerMemberRead('orgs/org-1/members/owner-1', { role: 'owner' })
    expect(last()).toEqual({ page: 'granted', tab: 'live', crm: 'granted' })

    expect(seen('page')).not.toContain('refused')
    expect(seen('tab')).not.toContain('absent')
    expect(seen('crm')).not.toContain('refused')
  })

  it('an EMPTY first snapshot is not "no org": nothing answers until the server has', async () => {
    render(<Console />)
    signIn('owner-1')
    // A cold cache: the listen's first answer is an empty list from cache.
    emitMemberships([], true)
    expect(mockMemberReads).toEqual([])
    expect(last()).toEqual({ page: 'pending', tab: 'placeholder', crm: 'pending' })

    // The server's answer names the org the URL names.
    emitMemberships([membership('org-1', 'aglyn-org')], false)
    expect(last().page).toBe('pending')
    await answerMemberRead('orgs/org-1/members/owner-1', { role: 'owner' })
    expect(last().page).toBe('granted')

    expect(seen('page')).not.toContain('refused')
    expect(seen('tab')).not.toContain('absent')
  })

  it('a member the role genuinely refuses is still refused, once the role is known', async () => {
    render(<Console />)
    signIn('viewer-1')
    emitMemberships([membership('org-1', 'aglyn-org')], true)

    // Never a grant from a guess: the viewer lacks `data.manage`, which the
    // stale "no org, act as owner" answer used to hand the org CRM.
    expect(last()).toEqual({ page: 'pending', tab: 'placeholder', crm: 'pending' })
    expect(seen('crm')).not.toContain('granted')

    await answerMemberRead('orgs/org-1/members/viewer-1', { role: 'viewer' })
    expect(last()).toEqual({ page: 'refused', tab: 'absent', crm: 'refused' })
    expect(seen('page')).not.toContain('granted')
    expect(seen('crm')).not.toContain('granted')
  })
})

describe('moving between organizations (AGL-3337)', () => {
  it("one org's answer is never read as another's, in either direction", async () => {
    const view = render(<Console />)
    signIn('member-1')
    emitMemberships(
      [membership('org-1', 'aglyn-org'), membership('org-2', 'client-org')],
      false,
    )
    await answerMemberRead('orgs/org-1/members/member-1', { role: 'owner' })
    expect(last().page).toBe('granted')

    // Into an org where this member is a viewer. The owner answer from the
    // org just left must not carry over while the new read is in flight.
    frames = []
    mockRoute.orgSlug = 'client-org'
    mockRoute.pathname = '/client-org/outreach/compliance'
    view.rerender(<Console />)
    expect(seen('page')).not.toContain('granted')
    expect(last().page).toBe('pending')
    await answerMemberRead('orgs/org-2/members/member-1', { role: 'viewer' })
    expect(last().page).toBe('refused')

    // And back. The viewer answer must not refuse the owner on the way in.
    frames = []
    mockMemberReads.length = 0
    mockRoute.orgSlug = 'aglyn-org'
    mockRoute.pathname = '/aglyn-org/outreach/compliance'
    view.rerender(<Console />)
    expect(seen('page')).not.toContain('refused')
    expect(seen('tab')).not.toContain('absent')
    await answerMemberRead('orgs/org-1/members/member-1', { role: 'owner' })
    expect(last().page).toBe('granted')
  })
})

describe('an account with no organization yet (AGL-3337)', () => {
  it('acts as an owner once the server confirms the list is empty, plugin keys included', async () => {
    mockRoute.orgSlug = undefined
    mockRoute.pathname = '/'
    render(<Console />)
    signIn('fresh-1')
    emitMemberships([], true)
    // A cache miss is not an empty list.
    expect(last().page).toBe('pending')

    emitMemberships([], false)
    // The owner of its future org holds what an owner holds: the dotted
    // catalog AND the plugin keys, which used to resolve at the viewer tier.
    expect(last()).toEqual({ page: 'granted', tab: 'live', crm: 'granted' })
    expect(mockMemberReads).toEqual([])
    expect(seen('page')).not.toContain('refused')
  })
})
