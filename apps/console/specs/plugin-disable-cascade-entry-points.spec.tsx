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
 * EVERY entry point to a plugin disable asks first (AGL-2486).
 *
 * `org-plugins-disable-cascade` and `site-plugins-disable-cascade` each prove
 * one LIST surface warns. That was the whole of the coverage while the switch
 * lived only on those two lists — and it is exactly the coverage that says
 * nothing when a third surface grows a switch of its own, which is what the
 * two plugin DETAIL pages have now done.
 *
 * So this suite asks the question the other two cannot: is there any way to
 * turn a plugin off that does not go through the check? Two halves, because
 * one alone is not an answer:
 *
 * 1. **Structural.** Every surface that renders a plugin-enablement switch
 *    gets its writer from `use-plugin-switchboard` and renders the cascade
 *    dialog, and none of them writes enablement itself. A behavioral test
 *    proves the surfaces that exist today; this one fails when a fourth
 *    surface hand-rolls a `set-enabled-plugins` POST or a `disabledPlugins`
 *    `setDoc`, which is the shape the next regression will take.
 *
 * 2. **Behavioral.** The two DETAIL pages — the entry points that had no
 *    check at all — open the dialog, write nothing on Cancel, and write the
 *    whole cascade at once on Continue.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const REPO_ROOT = join(__dirname, '../../..')

/**
 * Every surface that offers a plugin enable/disable switch, and must
 * therefore route through the shared writer.
 *
 * Listed by hand rather than discovered, deliberately: a scan for "files that
 * render a Switch" would sweep in every unrelated toggle in the console and
 * would have to be exempted back down, and the exemption list is where a real
 * surface goes to be forgotten.
 */
const SWITCH_SURFACES = [
  'apps/console/app/(app)/[orgSlug]/plugins/page.tsx',
  'apps/console/app/(app)/[orgSlug]/plugins/[pluginRef]/page.tsx',
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/admin/plugins/[pluginRef]/page.tsx',
  'apps/console/components/site-plugins-card.component.tsx',
]

describe('every plugin-enablement surface shares one writer', () => {
  for (const path of SWITCH_SURFACES) {
    const source = readFileSync(join(REPO_ROOT, path), 'utf8')

    it(`${path} takes its switchboard from the shared hook`, () => {
      expect(source).toContain("from '")
      expect(source).toMatch(/hooks\/use-plugin-switchboard'/)
      expect(source).toMatch(/use(Org|Site)PluginSwitchboard\(/)
    })

    it(`${path} renders the cascade dialog`, () => {
      expect(source).toContain('PluginDisableCascadeDialog')
    })

    it(`${path} does not write enablement itself`, () => {
      // The two writes that exist. A surface that spells either one out is a
      // surface with its own path to the store, and the cascade check is in
      // front of the hook rather than in front of the store.
      expect(source).not.toContain("action: 'set-enabled-plugins'")
      expect(source).not.toContain("mergeFields: ['disabledPlugins'")
    })
  }
})

// ---------------------------------------------------------------------------
// Behavioral: the two detail pages.
// ---------------------------------------------------------------------------

const ORG_ID = 'org-1'
const HOST_ID = 'host-1'

let mockPluginRef = 'commerce'
let mockOrg: Record<string, unknown> = {}
let mockHostDoc: Record<string, unknown> = {}
let mockIsAdmin = true

const mockSetDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginRef: mockPluginRef }),
}))
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(async () => ({ exists: () => false, data: () => null })),
  setDoc: jest.fn(async () => undefined),
  deleteField: jest.fn(() => ({})),
  collection: jest.fn(() => ({})),
  limit: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
}))
/*
 * COMPLETE, not partial. Both pages, the switchboard hook, the settings form
 * and the cascade dialog all import from this module, and a member left
 * `undefined` by a partial mock surfaces as "Element type is invalid" pointing
 * at whichever parent happened to render it — a failure that reads as a broken
 * component rather than a missing mock.
 */
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: null, status: 'success', fromCache: false }),
  useFirestoreCollection: () => ({ data: [] }),
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
  useHost: () => ({
    doc: { data: mockHostDoc, status: 'success', fromCache: false },
    setDoc: mockSetDoc,
  }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => <span aria-hidden="true" />,
}))
const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => <span>{'Acme site'}</span>,
}))
jest.mock('../components/auth-screens-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => HOST_ID,
  useHostSubdomain: () => 'acme',
  useIsHostAdmin: () => mockIsAdmin,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, orgId: ORG_ID, ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    currentOrg: { $id: ORG_ID, role: 'owner' },
    loading: false,
  }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))

import OrgPluginInstallation from '../app/(app)/[orgSlug]/plugins/[pluginRef]/page'
import SitePluginInstallation from '../app/(app)/[orgSlug]/hosts/[host]/admin/plugins/[pluginRef]/page'

const buttonNamed = (name: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name,
  )

const switchLabelled = (label: string): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )
  if (!input) throw new Error(`No "${label}" switch on the page`)
  return input
}

/** The plugin set the workspace API was asked to store, or null. */
const savedOrgSet = (): string[] | null => {
  const calls = (globalThis.fetch as jest.Mock).mock.calls.filter(
    ([url]) => url === '/api/orgs/settings',
  )
  if (!calls.length) return null
  return JSON.parse(calls[calls.length - 1][1].body).enabledPlugins
}

describe('the plugin detail pages run the cascade check (AGL-2486)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPluginRef = 'commerce'
    mockIsAdmin = true
    // Both scopes have User Accounts on, and it declares `requires:
    // ['commerce']` — so switching Commerce off strands it.
    mockOrg = { enabledPlugins: ['mui', 'commerce', 'accounts'] }
    mockHostDoc = { $id: HOST_ID, enabledPlugins: ['accounts'] }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        placements: 3,
        affectedScreens: 2,
        truncated: false,
      }),
    }) as unknown as typeof fetch
  })

  describe('the SITE page', () => {
    it('opens the cascade dialog instead of writing', async () => {
      render(<SitePluginInstallation />)
      fireEvent.click(switchLabelled('Toggle Commerce on this site'))
      await waitFor(() => expect(buttonNamed('Continue and disable those too')).toBeTruthy())
      expect(document.body.textContent).toContain('User Accounts')
      // The whole point: nothing has been stored yet.
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('Cancel writes nothing at all', async () => {
      render(<SitePluginInstallation />)
      fireEvent.click(switchLabelled('Toggle Commerce on this site'))
      await waitFor(() => expect(buttonNamed('Cancel')).toBeTruthy())
      fireEvent.click(buttonNamed('Cancel') as HTMLElement)
      await waitFor(() =>
        expect(buttonNamed('Continue and disable those too')).toBeFalsy(),
      )
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('Continue disables the plugin AND its dependent in one write', async () => {
      render(<SitePluginInstallation />)
      fireEvent.click(switchLabelled('Toggle Commerce on this site'))
      await waitFor(() => expect(buttonNamed('Continue and disable those too')).toBeTruthy())
      fireEvent.click(buttonNamed('Continue and disable those too') as HTMLElement)
      await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
      const [payload] = mockSetDoc.mock.calls[0]
      // Commerce joins the deny-list; User Accounts leaves the opt-in list,
      // because those are the two fields its own kind of row writes.
      expect(payload.disabledPlugins).toContain('commerce')
      expect(payload.enabledPlugins).not.toContain('accounts')
    })

    /**
     * The CONTROL. A plugin nothing declares a dependency on must not open a
     * dialog — otherwise every assertion above passes for a dialog that opens
     * on every disable, which is a different (and useless) feature.
     */
    it('a plugin with no dependents writes straight through', async () => {
      mockPluginRef = 'redirects'
      mockOrg = {
        enabledPlugins: ['mui', 'commerce', 'accounts', 'redirects'],
      }
      render(<SitePluginInstallation />)
      fireEvent.click(switchLabelled('Toggle Redirects on this site'))
      await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
      expect(buttonNamed('Continue and disable those too')).toBeFalsy()
      expect(mockSetDoc.mock.calls[0][0].disabledPlugins).toContain('redirects')
    })
  })

  describe('the WORKSPACE page', () => {
    it('opens the cascade dialog instead of writing', async () => {
      render(<OrgPluginInstallation />)
      fireEvent.click(switchLabelled('Toggle Commerce for this workspace'))
      await waitFor(() => expect(buttonNamed('Continue and disable those too')).toBeTruthy())
      expect(savedOrgSet()).toBeNull()
    })

    it('Continue removes the plugin AND its dependent in one request', async () => {
      render(<OrgPluginInstallation />)
      fireEvent.click(switchLabelled('Toggle Commerce for this workspace'))
      await waitFor(() => expect(buttonNamed('Continue and disable those too')).toBeTruthy())
      fireEvent.click(buttonNamed('Continue and disable those too') as HTMLElement)
      await waitFor(() => expect(savedOrgSet()).toBeTruthy())
      expect(savedOrgSet()).not.toContain('commerce')
      expect(savedOrgSet()).not.toContain('accounts')
    })

    /** The same CONTROL at workspace scope. */
    it('a plugin with no dependents writes straight through', async () => {
      mockPluginRef = 'redirects'
      mockOrg = {
        enabledPlugins: ['mui', 'commerce', 'accounts', 'redirects'],
      }
      render(<OrgPluginInstallation />)
      fireEvent.click(switchLabelled('Toggle Redirects for this workspace'))
      await waitFor(() => expect(savedOrgSet()).toBeTruthy())
      expect(buttonNamed('Continue and disable those too')).toBeFalsy()
      expect(savedOrgSet()).not.toContain('redirects')
    })
  })
})
