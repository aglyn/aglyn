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
 * The org Plugins page reads the set it is displaying (AGL-2486).
 *
 * It called `resolveEnabledPlugins((org as any)?.enabledPlugins)` — passing
 * the ARRAY to a function whose parameter is the org DOCUMENT. An array has
 * no `enabledPlugins` property, so the resolver saw `undefined` and returned
 * `DEFAULT_ENABLED_PLUGINS` every time: the page reported every plugin as
 * enabled no matter what the workspace had stored. The `as any` is what kept
 * the compiler quiet about it.
 *
 * Two harms, and the second is the serious one:
 *
 *  1. The page shows a state it is not reading — the exact "the control
 *     exists but does not behave" shape this issue is full of. It would also
 *     make the new per-site User Accounts default-off switch look broken to
 *     the first person who checked here.
 *  2. `toggle` does a read-modify-WRITE off that same value and
 *     `set-enabled-plugins` REPLACES the array. So flipping any one plugin
 *     saved the defaults plus/minus that id — silently switching every
 *     plugin the workspace had turned off back ON, for every site in it.
 *     That is precisely the corruption the AGL-1422 `orgReady` guard right
 *     above it was written to prevent, and this defeated it while `orgReady`
 *     was perfectly true.
 *
 * So the write is asserted here too, not just the switch positions: a fix
 * that corrected only the display would leave the destructive half standing.
 */

import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'

/** The stored org document. The workspace has switched most plugins OFF. */
let mockOrg: Record<string, unknown>

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
  useUser: () => ({ uid: 'user-1', getIdToken: async () => 'token' }),
}))
jest.mock('../../../hooks/use-org-hosts', () => ({}), { virtual: true })
jest.mock('../hooks/use-org-hosts', () => ({
  useOrgHosts: () => ({ hosts: [] }),
}))
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  default: () => ({ branding: { productName: 'Aglyn' } }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrg, ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { role: 'owner', $id: ORG_ID } }),
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [] }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

import OrgPlugins from '../app/(app)/[orgSlug]/plugins/page'

/** MUI's Switch carries the label on its inner input. Throws when absent. */
const switchFor = (label: string): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )
  if (!input) throw new Error(`No "${label}" switch on the page`)
  return input
}

/** Every switch on the page, by its accessible name and position. */
const allSwitches = () =>
  Object.fromEntries(
    Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).map((input) => [input.getAttribute('aria-label') ?? '', input.checked]),
  )

beforeEach(() => {
  jest.clearAllMocks()
  ;(globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({}),
  }))
  // Stored: ONLY the base component library. Everything else is off.
  mockOrg = { $id: ORG_ID, enabledPlugins: ['mui'] }
})

describe('org Plugins page reads the stored set (AGL-2486)', () => {
  it('shows a plugin the workspace switched OFF as off', async () => {
    render(<OrgPlugins />)
    await waitFor(() => expect(switchFor('Toggle Commerce')).toBeTruthy())
    expect(switchFor('Toggle Commerce').checked).toBe(false)
  })

  it('does not report the whole catalog as enabled', async () => {
    // The bug's signature: every switch on, whatever is stored. Asserted as
    // a set rather than one row, because the failure was uniform.
    render(<OrgPlugins />)
    await waitFor(() => expect(switchFor('Toggle Commerce')).toBeTruthy())
    const positions = allSwitches()
    const onCount = Object.values(positions).filter(Boolean).length
    expect(onCount).toBeLessThan(Object.keys(positions).length)
  })

  it('still shows a stored plugin as ON', async () => {
    // The other direction, so a fix that simply renders everything OFF is
    // not mistaken for a fix.
    mockOrg = { $id: ORG_ID, enabledPlugins: ['mui', 'commerce'] }
    render(<OrgPlugins />)
    await waitFor(() => expect(switchFor('Toggle Commerce')).toBeTruthy())
    expect(switchFor('Toggle Commerce').checked).toBe(true)
  })

  it('pins the exact set a save would serialize', () => {
    // The destructive half of the bug, asserted where it can be asserted.
    // `toggle` builds its payload as `new Set(enabled)` plus/minus one id,
    // and `set-enabled-plugins` REPLACES the array — so a save built from
    // the DEFAULT set re-enables everything this workspace had turned off,
    // across every site in it. That payload is `enabled` by construction,
    // so pinning the ON set pins the write.
    //
    // Not driven through a click on purpose: the row is a link, so the
    // switch's onClick calls preventDefault to stop a toggle also
    // navigating, and in jsdom that cancels the checkbox's default action
    // and with it the change event. Firing one anyway would assert that a
    // handler never ran.
    render(<OrgPlugins />)
    const on = Object.entries(allSwitches())
      .filter(([, checked]) => checked)
      .map(([label]) => label)
    // Two, not one: `forms` is always-on like the component library, so it is
    // unioned into every org's resolved set and its switch is on and inert.
    expect(on).toEqual(['Toggle Components', 'Toggle Forms'])
  })

  it('an absent field still means the full default set', async () => {
    // The genuine fallback must survive the fix: an org that never touched
    // the switchboard runs everything.
    mockOrg = { $id: ORG_ID }
    render(<OrgPlugins />)
    await waitFor(() => expect(switchFor('Toggle Commerce')).toBeTruthy())
    expect(switchFor('Toggle Commerce').checked).toBe(true)
  })
})
