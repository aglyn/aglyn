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
 * THE PLUGIN SWITCH'S SENTENCE NAMES THE PERMISSION IT ASKS (AGL-4047).
 *
 * The workspace switch asks `org.settings`, and the sentence under it used to
 * say the switch was for owners and admins: someone granted the key by a custom
 * role was told they couldn't, and an admin refused it was told they could. It
 * also showed whenever the switch could not write, which includes the moment
 * the permissions are still loading and a read that failed.
 *
 * These drive the rendered page with the real resolver, so a role, a custom
 * role and an override each move the sentence the way they move the switch.
 */

import {
  permissionRefusalText,
  resolveOrgPermissions,
  type AglynOrgCustomRole,
} from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * What `useOrgPermissions` answers, by its three states: `loading` reads as
 * all granted and `error` as all denied, each with `loaded` false, exactly as
 * the hook does. A ready member goes through the real resolver.
 */
type MockPermissions =
  | { status: 'loading' | 'error' }
  | {
      status: 'ready'
      member: Parameters<typeof resolveOrgPermissions>[0]
      customRole?: AglynOrgCustomRole
    }
let mockPermissions: MockPermissions = { status: 'loading' }
jest.mock('../hooks/use-org-permissions', () => {
  const answer = () => {
    const state = mockPermissions
    if (state.status !== 'ready') {
      return {
        loaded: false,
        errored: state.status === 'error',
        can: () => state.status === 'loading',
      }
    }
    const granted = jest
      .requireActual('@aglyn/aglyn')
      .resolveOrgPermissions(state.member, state.customRole ?? null)
    return {
      loaded: true,
      errored: false,
      can: (key: string) => granted[key] === true,
    }
  }
  return { __esModule: true, default: answer, useOrgPermissions: answer }
})

jest.mock('next/navigation', () => ({
  useParams: () => ({ pluginRef: 'commerce' }),
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
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: null, status: 'success', fromCache: false }),
  useFirestoreCollection: () => ({ data: [] }),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
  useHost: () => ({ doc: { data: null }, setDoc: jest.fn() }),
  writeGuardedBySeed: jest.fn(),
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
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/plugin-config-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/plugin-dependencies-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { enabledPlugins: ['mui', 'commerce'] },
    orgId: 'org-1',
    ready: true,
  }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    currentOrg: { $id: 'org-1', role: 'owner' },
    loading: false,
  }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))

import OrgPluginInstallation from '../app/(app)/[orgSlug]/plugins/[pluginRef]/page'

const REFUSAL =
  'Your role does not include "Organization settings" — ask an organization admin'

const member = (
  role: string,
  extra: Record<string, unknown> = {},
): MockPermissions => ({
  status: 'ready',
  member: { role: role as never, ...extra },
})

const theSwitch = () =>
  screen.getByLabelText('Toggle Commerce for this workspace') as HTMLInputElement

/** Renders the page with this answer and says what the reader is shown. */
const shown = (state: MockPermissions) => {
  mockPermissions = state
  const { container, unmount } = render(<OrgPluginInstallation />)
  const answer = {
    text: container.textContent ?? '',
    switchDisabled: theSwitch().disabled,
  }
  unmount()
  return answer
}

describe('the plugin switch says why it is off, from the key', () => {
  it('uses the standard refusal for the key, not its own wording', () => {
    expect(REFUSAL).toBe(permissionRefusalText('org.settings'))
  })

  it('a holder sees the switch on and no refusal', () => {
    for (const role of ['owner', 'admin']) {
      const { text, switchDisabled } = shown(member(role))
      expect(switchDisabled).toBe(false)
      expect(text).not.toContain(REFUSAL)
    }
  })

  it('someone without the key sees the switch off, with the permission named', () => {
    for (const role of ['editor', 'author', 'viewer']) {
      const { text, switchDisabled } = shown(member(role))
      expect(switchDisabled).toBe(true)
      expect(text).toContain(REFUSAL)
    }
  })

  it('a custom role that grants the key is not told it cannot', () => {
    const { text, switchDisabled } = shown({
      status: 'ready',
      member: { role: 'viewer', roleId: 'custom-1' },
      customRole: { permissions: { 'org.settings': true } } as AglynOrgCustomRole,
    })
    expect(switchDisabled).toBe(false)
    expect(text).not.toContain(REFUSAL)
  })

  it('a custom role that takes the key from an admin is told so', () => {
    const { text, switchDisabled } = shown({
      status: 'ready',
      member: { role: 'admin', roleId: 'custom-1' },
      customRole: { permissions: { 'org.settings': false } } as AglynOrgCustomRole,
    })
    expect(switchDisabled).toBe(true)
    expect(text).toContain(REFUSAL)
  })

  it('an override grant moves it for a role that does not hold the key', () => {
    const { text, switchDisabled } = shown(
      member('viewer', { permissions: { 'org.settings': true } }),
    )
    expect(switchDisabled).toBe(false)
    expect(text).not.toContain(REFUSAL)
  })

  it('an admin refused the key by an override is told so', () => {
    const { text, switchDisabled } = shown(
      member('admin', { permissions: { 'org.settings': false } }),
    )
    expect(switchDisabled).toBe(true)
    expect(text).toContain(REFUSAL)
  })

  it('says nothing while the permissions load, or when the read failed', () => {
    for (const status of ['loading', 'error'] as const) {
      const { text, switchDisabled } = shown({ status })
      expect(switchDisabled).toBe(true)
      expect(text).not.toContain(REFUSAL)
    }
  })

  it('never states a role as the rule', () => {
    for (const state of [member('owner'), member('viewer'), { status: 'loading' } as const]) {
      expect(shown(state).text).not.toMatch(/owners and admins/i)
    }
  })
})
