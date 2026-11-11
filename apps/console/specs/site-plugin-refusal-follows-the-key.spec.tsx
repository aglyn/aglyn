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
 * THE SITE'S PLUGIN PAGE NAMES THE PERMISSION IT ASKS (AGL-4047).
 *
 * Everything this page writes asks "Manage site settings" (`site.manage`) of
 * the rules: the site's plugin lists and sign-in pages on the host document,
 * and `hosts/{hostId}/pluginSettings/{pluginId}`. The notice used to state a
 * role as the rule, which a site admin refused the key could not make sense
 * of, and it showed to everyone while the site loaded. The sign-in page pickers
 * stayed live for someone the rules would refuse.
 *
 * Driven through the REAL host provider, reading a host document the way the
 * rules read it: the site's stamp, else the preset of the member's site role.
 */

import { permissionRefusalText } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const UID = 'u1'
const HOST_ID = 'host-1'

/** What the host-document listener currently reports. */
let mockHostDoc: Record<string, unknown> = {}

jest.mock('next/navigation', () => {
  const router = { replace: jest.fn(), push: jest.fn(), prefetch: jest.fn() }
  return {
    useRouter: () => router,
    usePathname: () => '/acme/hosts/acme-site/admin/plugins/accounts',
    useParams: () => ({
      orgSlug: 'acme',
      host: 'acme-site',
      pluginRef: 'accounts',
    }),
  }
})
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({})),
  collection: jest.fn(() => ({})),
  deleteField: jest.fn(() => ({})),
  getDoc: jest.fn(async () => ({ exists: () => false, data: () => null })),
  getDocsFromServer: jest.fn(async () => ({ docs: [] })),
  limit: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  setDoc: jest.fn(async () => undefined),
  where: jest.fn(() => ({})),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: null, status: 'success', fromCache: false }),
  firestoreDocPhase: jest.requireActual('@aglyn/tenant-feature-instance')
    .firestoreDocPhase,
  useFirestoreCollection: () => ({ data: [] }),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
  writeGuardedBySeed: jest.fn(),
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: null, status: 'success', fromCache: false }),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [] }),
}))
jest.mock('../hooks/use-host', () => ({
  useHost: () => ({ doc: mockHostDoc, setDoc: jest.fn() }),
}))
jest.mock('../hooks/use-host-resolution', () => ({
  useHostResolution: () => ({
    hostId: 'host-1',
    ready: true,
    error: false,
    authError: false,
    retry: jest.fn(),
  }),
}))
jest.mock('../hooks/use-auth-recovery', () => ({
  useAuthRecovery: () => undefined,
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
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => <span>{'Acme site'}</span>,
}))
jest.mock('../components/plugin-config-card.component', () => ({
  __esModule: true,
  default: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="settings-form" data-disabled={String(Boolean(disabled))} />
  ),
}))
jest.mock('../components/plugin-dependencies-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { enabledPlugins: ['mui', 'accounts'] }, ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => {
  const value = { loaded: true, can: () => true }
  return { __esModule: true, default: () => value, useOrgPermissions: () => value }
})
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    currentOrg: { $id: 'org-1', slug: 'acme', role: 'owner' },
    orgs: [{ $id: 'org-1', slug: 'acme' }],
    loading: false,
    error: false,
    authError: false,
    retry: jest.fn(),
  }),
  useOrgSlug: () => 'acme',
}))

import HostIdProvider from '../components/host-id-provider'
import SitePluginInstallation from '../app/(app)/[orgSlug]/hosts/[host]/admin/plugins/[pluginRef]/page'

const REFUSAL =
  'Your role does not include "Manage site settings" — ask an organization admin'

/** The document the listener answers with once the server has spoken. */
const hostDoc = (fields: Record<string, unknown>) => ({
  data: { $id: HOST_ID, ...fields },
  status: 'success',
  fromCache: false,
  serverDenied: false,
})
const onSite = (role: string) => hostDoc({ memberRoles: { [UID]: role } })
const stamped = (role: string, verdict: boolean) =>
  hostDoc({
    memberRoles: { [UID]: role },
    memberPermissions: { [UID]: { 'site.manage': verdict } },
  })

/** Renders the page and says what the reader is shown. */
const shown = (next: Record<string, unknown>) => {
  mockHostDoc = next
  const { container, unmount } = render(
    <HostIdProvider>
      <SitePluginInstallation />
    </HostIdProvider>,
  )
  const answer = {
    text: container.textContent ?? '',
    switchDisabled: (screen.getByRole('switch', {
      name: /on this site/,
    }) as HTMLInputElement).disabled,
    formDisabled:
      screen.getByTestId('settings-form').getAttribute('data-disabled') === 'true',
    signInPageDisabled:
      screen
        .getByRole('combobox', { name: 'Sign-in page' })
        .getAttribute('aria-disabled') === 'true',
  }
  unmount()
  return answer
}

const expectOpen = (answer: ReturnType<typeof shown>) => {
  expect(answer.switchDisabled).toBe(false)
  expect(answer.formDisabled).toBe(false)
  expect(answer.signInPageDisabled).toBe(false)
  expect(answer.text).not.toContain(REFUSAL)
}
const expectRefused = (answer: ReturnType<typeof shown>) => {
  expect(answer.switchDisabled).toBe(true)
  expect(answer.formDisabled).toBe(true)
  expect(answer.signInPageDisabled).toBe(true)
  expect(answer.text).toContain(REFUSAL)
}

describe('the site plugin page says why it is read-only, from the key', () => {
  it('uses the standard refusal for the key, not its own wording', () => {
    expect(REFUSAL).toBe(permissionRefusalText('site.manage'))
  })

  it('a site admin holds the key by its preset, as today', () => {
    expectOpen(shown(onSite('admin')))
  })

  it('every other site role is refused by its preset, as today', () => {
    for (const role of ['editor', 'author', 'viewer']) {
      expectRefused(shown(onSite(role)))
    }
  })

  it('someone with no role on the site is refused', () => {
    expectRefused(shown(hostDoc({})))
  })

  it('a stamp that grants the key opens the page for a site role without it', () => {
    expectOpen(shown(stamped('viewer', true)))
  })

  it('a stamp that takes the key from a site admin is told so', () => {
    expectRefused(shown(stamped('admin', false)))
  })

  it('holds every control and says nothing while the site loads', () => {
    const answer = shown({
      data: undefined,
      status: 'loading',
      fromCache: true,
      serverDenied: false,
    })
    expect(answer.switchDisabled).toBe(true)
    expect(answer.formDisabled).toBe(true)
    expect(answer.signInPageDisabled).toBe(true)
    expect(answer.text).not.toContain(REFUSAL)
  })

  it('says nothing after a failed read, when nobody was refused anything', () => {
    for (const failed of [
      { data: undefined, status: 'error', fromCache: true, serverDenied: false },
      { data: undefined, status: 'success', fromCache: true, serverDenied: true },
    ]) {
      const answer = shown(failed)
      expect(answer.formDisabled).toBe(true)
      expect(answer.text).not.toContain(REFUSAL)
    }
  })

  it('never states a role as the rule', () => {
    for (const state of [onSite('admin'), onSite('viewer')]) {
      expect(shown(state).text).not.toMatch(/only site admins/i)
    }
  })
})
