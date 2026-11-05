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
 * THE PLUGINS LIST SAYS WHY ITS SWITCHES ARE OFF, FROM THE KEY (AGL-4047).
 *
 * The switches ask `org.settings` and were switched off with nothing said. The
 * plugin's own page already names the permission
 * (`plugin-switch-refusal-follows-the-key.spec.tsx`); this is the list beside
 * it. Driven through the real resolver, so a role, a custom role and an
 * override each move the sentence the way they move the switch.
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

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => ({})),
  documentId: jest.fn(() => '__name__'),
  getDocs: jest.fn(async () => ({ docs: [] })),
  limit: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
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
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  default: () => ({ branding: { productName: 'Aglyn' } }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { enabledPlugins: ['mui', 'commerce'] }, ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', role: 'owner' } }),
  useOrgSlug: () => 'acme',
}))

import OrgPlugins from '../app/(app)/[orgSlug]/plugins/page'

const REFUSAL =
  'Your role does not include "Organization settings" — ask an organization admin'

const member = (
  role: string,
  extra: Record<string, unknown> = {},
): MockPermissions => ({
  status: 'ready',
  member: { role: role as never, ...extra },
})

/** Renders the list with this answer and says what the reader is shown. */
const shown = (state: MockPermissions) => {
  mockPermissions = state
  const { container, unmount } = render(<OrgPlugins />)
  const theSwitch = screen.getByLabelText('Toggle Commerce') as HTMLInputElement
  const answer = {
    text: container.textContent ?? '',
    switchDisabled: theSwitch.disabled,
  }
  unmount()
  return answer
}

describe('the plugins list says why its switches are off, from the key', () => {
  it('uses the standard refusal for the key, not its own wording', () => {
    expect(REFUSAL).toBe(permissionRefusalText('org.settings'))
  })

  it('a holder sees the switches on and no refusal', () => {
    for (const role of ['owner', 'admin']) {
      const { text, switchDisabled } = shown(member(role))
      expect(switchDisabled).toBe(false)
      expect(text).not.toContain(REFUSAL)
    }
  })

  it('someone without the key sees them off, with the permission named', () => {
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

  it('an override moves it in both directions', () => {
    const granted = shown(member('viewer', { permissions: { 'org.settings': true } }))
    expect(granted.switchDisabled).toBe(false)
    expect(granted.text).not.toContain(REFUSAL)
    const refused = shown(member('admin', { permissions: { 'org.settings': false } }))
    expect(refused.switchDisabled).toBe(true)
    expect(refused.text).toContain(REFUSAL)
  })

  it('says nothing while the permissions load, or when the read failed', () => {
    for (const status of ['loading', 'error'] as const) {
      const { text, switchDisabled } = shown({ status })
      expect(switchDisabled).toBe(true)
      expect(text).not.toContain(REFUSAL)
    }
  })
})
