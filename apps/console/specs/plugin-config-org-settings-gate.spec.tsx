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
 * THE WORKSPACE PLUGIN SETTINGS FORM FOLLOWS `org.settings` (AGL-4047).
 *
 * The rules ask that key of `orgs/{orgId}/pluginSettings/{pluginId}`, and the
 * form writes that document client-direct, so a member without it was offered
 * a Save the write then refused. These drive the rendered form with the real
 * resolver and the real refusal sentence, so a role, a custom role and an
 * override each move it the way they move the rule.
 *
 * The site form writes another document under another key: its page passes
 * that gate as `disabled`, and `org.settings` has no say in it.
 */

import {
  registerPluginConfigSchema,
  resolveOrgPermissions,
  type AglynOrgCustomRole,
} from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDocCalls: Array<{ path: string }> = []
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  deleteField: () => ({ __delete: true }),
  doc: (_firestore: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  setDoc: async (ref: { path: string }) => {
    mockSetDocCalls.push({ path: ref.path })
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useFirestoreDoc: () => ({
    data: undefined,
    status: 'success',
    fromCache: false,
  }),
  writeGuardedBySeed: async (_options: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
}))

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
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => {
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
  },
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => ({}),
}))
jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  revalidateLivePages: async () => undefined,
}))

const PluginConfigCards =
  require('../components/plugin-config-card.component').default

const PLUGIN = 'org-settings-gate-plugin'
const REFUSAL =
  'Your role does not include "Organization settings" — ask an organization admin'

registerPluginConfigSchema({
  pluginId: PLUGIN,
  fields: [
    { key: 'horizonDays', label: 'Booking horizon', type: 'number' },
    { key: 'timeZone', label: 'Time zone', type: 'string' },
    { key: 'open', label: 'Open', type: 'boolean' },
  ],
  defaults: { horizonDays: 60, timeZone: 'UTC', open: true },
})

const member = (
  role: string,
  extra: Record<string, unknown> = {},
): MockPermissions => ({
  status: 'ready',
  member: { role: role as never, ...extra },
})

const horizon = () =>
  screen.getByLabelText('Booking horizon') as HTMLInputElement
const openSwitch = () => screen.getByLabelText('Open') as HTMLInputElement
const saveButton = (name = 'Save settings') =>
  screen.getByRole<HTMLButtonElement>('button', { name })

const renderWorkspaceForm = () =>
  render(<PluginConfigCards orgId="org-1" pluginId={PLUGIN} />)

/** Every control off and no write reachable; Save still on the page. */
const expectSwitchedOff = () => {
  expect(saveButton().disabled).toBe(true)
  expect(horizon().disabled).toBe(true)
  expect((screen.getByLabelText('Time zone') as HTMLInputElement).disabled).toBe(true)
  expect(openSwitch().disabled).toBe(true)
  fireEvent.click(saveButton())
  expect(mockSetDocCalls).toEqual([])
}

const expectWritable = async () => {
  expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  expect(openSwitch().disabled).toBe(false)
  fireEvent.change(horizon(), { target: { value: '120' } })
  expect(saveButton().disabled).toBe(false)
  fireEvent.click(saveButton())
  await waitFor(() => expect(mockSetDocCalls.length).toBeGreaterThan(0))
  expect(mockSetDocCalls[0].path).toBe(`orgs/org-1/pluginSettings/${PLUGIN}`)
}

beforeEach(() => {
  mockSetDocCalls.length = 0
  mockPermissions = { status: 'loading' }
})

describe('the workspace plugin settings form follows "Organization settings" (AGL-4047)', () => {
  it.each(['owner', 'admin'])('an %s holds it by default and saves', async (role) => {
    mockPermissions = member(role)
    renderWorkspaceForm()
    await expectWritable()
  })

  it.each(['editor', 'author', 'viewer'])(
    'an %s without it sees the form switched off, with the permission named',
    (role) => {
      mockPermissions = member(role)
      renderWorkspaceForm()
      expectSwitchedOff()
      expect(screen.getByLabelText(REFUSAL)).toBeTruthy()
    },
  )

  it('an override granting it opens the form for a role without it', async () => {
    mockPermissions = member('editor', { permissions: { 'org.settings': true } })
    renderWorkspaceForm()
    await expectWritable()
  })

  it('an override refusing it closes the form for an admin', () => {
    mockPermissions = member('admin', { permissions: { 'org.settings': false } })
    renderWorkspaceForm()
    expectSwitchedOff()
    expect(screen.getByLabelText(REFUSAL)).toBeTruthy()
  })

  it('a custom role decides it either way', async () => {
    mockPermissions = {
      status: 'ready',
      member: { role: 'admin' as never, roleId: 'r1' } as never,
      customRole: { permissions: { 'org.settings': false } } as AglynOrgCustomRole,
    }
    const refused = renderWorkspaceForm()
    expectSwitchedOff()
    expect(screen.getByLabelText(REFUSAL)).toBeTruthy()
    refused.unmount()

    mockPermissions = {
      status: 'ready',
      member: { role: 'viewer' as never, roleId: 'r2' } as never,
      customRole: { permissions: { 'org.settings': true } } as AglynOrgCustomRole,
    }
    renderWorkspaceForm()
    await expectWritable()
  })

  it('holds while the permissions load, which read as all granted, and accuses nobody', () => {
    renderWorkspaceForm()
    expectSwitchedOff()
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('holds on a failed read too, rather than telling a holder they lack it', () => {
    mockPermissions = { status: 'error' }
    renderWorkspaceForm()
    expectSwitchedOff()
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('opens once the answer arrives for a holder', async () => {
    const view = renderWorkspaceForm()
    expect(saveButton().disabled).toBe(true)
    mockPermissions = member('owner')
    view.rerender(<PluginConfigCards orgId="org-1" pluginId={PLUGIN} />)
    await expectWritable()
  })

  it('reads stay as they are: a member without it still sees the values', () => {
    mockPermissions = member('viewer')
    renderWorkspaceForm()
    expect(horizon().value).toBe('60')
    expect((screen.getByLabelText('Time zone') as HTMLInputElement).value).toBe('UTC')
  })
})

describe('the site form is not this key’s to decide', () => {
  const renderSiteForm = (disabled: boolean) =>
    render(
      <PluginConfigCards
        orgId="org-1"
        hostId="host-1"
        pluginId={PLUGIN}
        disabled={disabled}
      />,
    )

  it('saves for a site admin who does not hold "Organization settings"', async () => {
    mockPermissions = member('viewer')
    renderSiteForm(false)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    fireEvent.change(horizon(), { target: { value: '120' } })
    const save = saveButton('Save site settings')
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(mockSetDocCalls.length).toBeGreaterThan(0))
    expect(mockSetDocCalls[0].path).toBe(`hosts/host-1/pluginSettings/${PLUGIN}`)
  })

  it('does not wait on the org permissions', () => {
    renderSiteForm(false)
    expect(horizon().disabled).toBe(false)
  })

  it('still follows the page’s own gate, and never names this key', () => {
    mockPermissions = member('owner')
    renderSiteForm(true)
    expect(saveButton('Save site settings').disabled).toBe(true)
    expect(horizon().disabled).toBe(true)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })
})
