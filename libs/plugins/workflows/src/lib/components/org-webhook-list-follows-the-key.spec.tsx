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
 * THE ORG WEBHOOKS LIST ASKS WHAT THE RULE ASKS (AGL-4047).
 *
 * The rule on `hosts/{hostId}/webhooks` is `canReadHostSensitive`: "See orders
 * and webhooks" (`site.sensitive`), decided per site. The list asked the
 * workspace role's legacy `editHosts`, so it refused a viewer raised to Editor
 * on a site and opened refused listeners for an editor narrowed on one. Each row
 * below is a member kind, with the real site-preset resolver and the verdict the
 * rule gives it.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { OrgSiteAutomationList, OrgSiteWebhookList } from './org-site-automation-list.component'
import type { WorkflowsOrgMount } from './workflows-org-mount'

const REFUSAL = 'Your role does not include "See orders and webhooks" — ask an organization admin'
const PARTIAL = 'The webhooks of sites where your role does not include "See orders and webhooks" are not listed.'

type DocRead = { data: unknown; status: string; fromCache?: boolean }

const mockDocs = new Map<string, DocRead>()
const mockReads: string[] = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useFirestoreDoc: (build: () => { path: string } | null) => {
    const ref = build()
    if (!ref) return { data: undefined, status: 'loading', fromCache: false }
    return mockDocs.get(ref.path) ?? { data: undefined, status: 'loading', fromCache: false }
  },
  useFirestoreCollection: (build: () => { path: string } | null) => {
    const ref = build()
    if (ref) mockReads.push(ref.path)
    return { data: [], status: 'success', fromCache: false }
  },
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/host-collection-queries', () => ({
  collectionCeiling: (ref: unknown) => ref,
  ceilingedWindow: (rows: unknown) => ({ rows, truncated: false }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
}))
jest.mock('@aglyn/aglyn', () => ({
  hostEventLabel: (event: string) => event,
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: jest.requireActual('react').forwardRef(
    ({ componentVariant: _variant, children, ...rest }: Record<string, unknown>, ref: never) => (
      <a ref={ref} {...rest}>
        {children as never}
      </a>
    ),
  ),
  CardDisplay: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}))
jest.mock('@aglyn/shared-ui-jsx/components/scroll-table.component', () => ({
  ScrollTable: ({ children }: { children?: unknown }) => <table>{children as never}</table>,
}))

const MEMBER = 'orgs/org1/members/u1'
const ROLE = 'orgs/org1/roles/r1'

const mount = (sites = ['a', 'b']): WorkflowsOrgMount => ({
  orgId: 'org1',
  orgSlug: 'acme',
  hosts: sites.map((id) => ({ id, name: `Site ${id}`, subdomain: id })),
  hostsReady: true,
  hostsPath: '/acme/hosts',
  basePath: '/acme/automation',
})

const answered = (member: unknown) => mockDocs.set(MEMBER, { data: member, status: 'success', fromCache: false })
const addButton = () => screen.getByRole('button', { name: 'Add webhook on a site' }) as HTMLButtonElement

beforeEach(() => {
  mockDocs.clear()
  mockReads.length = 0
})

describe('which sites the list reads, member kind by member kind', () => {
  const siteA = 'hosts/a/webhooks'
  const siteB = 'hosts/b/webhooks'

  it.each<[string, Record<string, unknown>, string[]]>([
    ['the owner', { role: 'owner', allHosts: true }, [siteA, siteB]],
    ['an admin', { role: 'admin', allHosts: true }, [siteA, siteB]],
    ['an editor', { role: 'editor', allHosts: true }, [siteA, siteB]],
    ['a viewer', { role: 'viewer', allHosts: true }, []],
    ['an editor narrowed to Author on one site', { role: 'editor', allHosts: true, hostAccess: { a: 'author' } }, [siteB]],
    ['an editor narrowed to Viewer on one site', { role: 'editor', allHosts: true, hostAccess: { a: 'viewer' } }, [siteB]],
    ['a viewer raised to Editor on one site', { role: 'viewer', allHosts: true, hostAccess: { b: 'editor' } }, [siteB]],
    ['a collaborator, Admin on one site', { role: 'viewer', allHosts: false, hostAccess: { a: 'admin' } }, [siteA]],
    ['a collaborator, Editor on one site', { role: 'viewer', allHosts: false, hostAccess: { a: 'editor' } }, [siteA]],
    ['a collaborator, Author on one site', { role: 'viewer', allHosts: false, hostAccess: { a: 'author' } }, []],
    ['a collaborator, Viewer on one site', { role: 'viewer', allHosts: false, hostAccess: { a: 'viewer' } }, []],
    [
      'an editor whose own override refuses the key',
      { role: 'editor', allHosts: true, permissions: { 'site.sensitive': false } },
      [],
    ],
    [
      'a viewer whose own override grants the key',
      { role: 'viewer', allHosts: true, permissions: { 'site.sensitive': true } },
      [siteA, siteB],
    ],
    [
      'an editor the site toggles off on one site',
      { role: 'editor', allHosts: true, hostPermissions: { a: { 'site.sensitive': false } } },
      [siteB],
    ],
    [
      'a collaborator the site toggles on, Author there',
      { role: 'viewer', allHosts: false, hostAccess: { a: 'author' }, hostPermissions: { a: { 'site.sensitive': true } } },
      [siteA],
    ],
  ])('%s', (_name, member, reads) => {
    answered(member)
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(mockReads).toEqual(reads)
  })

  it('a custom role decides for a member of the whole workspace', () => {
    answered({ role: 'editor', allHosts: true, roleId: 'r1' })
    mockDocs.set(ROLE, { data: { permissions: { 'site.sensitive': false } }, status: 'success', fromCache: false })
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(mockReads).toEqual([])
    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })

  it('holds while a custom role is out', () => {
    answered({ role: 'editor', allHosts: true, roleId: 'r1' })
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(mockReads).toEqual([])
    expect(screen.queryByText(REFUSAL)).toBeNull()
    expect(screen.getByText('…')).toBeTruthy()
  })

  it('a reader with no membership is staff, whom the rule admits', () => {
    answered(null)
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(mockReads).toEqual([siteA, siteB])
  })

  it('a cached "missing" is not yet an answer', () => {
    mockDocs.set(MEMBER, { data: null, status: 'success', fromCache: true })
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(mockReads).toEqual([])
    expect(screen.getByText('…')).toBeTruthy()
  })
})

describe('what the reader is told', () => {
  it('names the permission when no site holds it, and switches Add off with it', () => {
    answered({ role: 'viewer', allHosts: true })
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(screen.getByText(REFUSAL)).toBeTruthy()
    expect(addButton().disabled).toBe(true)
    expect(addButton().closest('[aria-label]')?.getAttribute('aria-label')).toBe(REFUSAL)
  })

  it('says some sites are left out when only some hold it, and offers Add on those alone', () => {
    answered({ role: 'editor', allHosts: true, hostAccess: { a: 'viewer' } })
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(screen.getByText(PARTIAL)).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
    expect(addButton().disabled).toBe(false)
    fireEvent.click(addButton())
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Site b'])
  })

  it('says nothing for a member who holds it everywhere (negative control)', () => {
    answered({ role: 'editor', allHosts: true })
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(screen.queryByText(REFUSAL)).toBeNull()
    expect(screen.queryByText(PARTIAL)).toBeNull()
    expect(addButton().closest('[aria-label]')).toBeNull()
  })

  it('never refuses while the member read is out, and says so when it failed', () => {
    const { unmount } = render(<OrgSiteWebhookList mount={mount()} />)
    expect(screen.queryByText(REFUSAL)).toBeNull()
    expect(addButton().disabled).toBe(true)
    unmount()
    mockDocs.set(MEMBER, { data: undefined, status: 'error', fromCache: false })
    render(<OrgSiteWebhookList mount={mount()} />)
    expect(mockReads).toEqual([])
    expect(screen.queryByText(REFUSAL)).toBeNull()
    expect(screen.getByText('Your access could not be checked. Reload the page to try again.')).toBeTruthy()
  })
})

describe('workflows and actions are not gated', () => {
  it.each(['workflows', 'actions'] as const)('%s reads every site and no member', (kind) => {
    render(<OrgSiteAutomationList mount={mount()} kind={kind} />)
    expect(mockReads).toEqual([`hosts/a/${kind}`, `hosts/b/${kind}`])
  })
})
