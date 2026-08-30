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
 * Disabling a plugin another one depends on warns first (AGL-2486), on the
 * ORG switchboard.
 *
 * The org path is the wider one and is tested separately for that reason: a
 * site can never turn back on what the workspace has switched off, so an
 * org-level disable lands on EVERY site in the workspace at once. It is also
 * the more dangerous shape to get wrong, because this page saves on change —
 * there is no Save button between the toggle and the write, so the dialog is
 * the only thing standing there.
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const ORG_ID = 'org-1'

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

const switchFor = (label: string): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )
  if (!input) throw new Error(`No "${label}" switch on the page`)
  return input
}

/**
 * A plain `click`, which is what a person does.
 *
 * It had to become one. The row is a link, so the switch's `onClick` calls
 * `preventDefault` to stop a toggle also navigating — and that cancels the
 * checkbox's activation behaviour, so no change event is produced and the
 * page's `onChange` never ran. Neither `click` nor `change` reached `toggle`
 * here, which is how it came out that EVERY switch on this page had been
 * inert since AGL-1011, in the real browser and not only in jsdom. The page
 * now reads the intent from the click, so this fires the real path.
 */
const flipOff = (label: string) => fireEvent.click(switchFor(label))

const buttonNamed = (name: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name,
  )

const continueButton = () => buttonNamed('Continue and disable those too')
const cancelButton = () => buttonNamed('Cancel')

/** The array `set-enabled-plugins` was asked to persist, or null. */
const savedSet = (): string[] | null => {
  const calls = (globalThis.fetch as jest.Mock).mock.calls.filter(
    ([url]) => url === '/api/orgs/settings',
  )
  if (!calls.length) return null
  const body = JSON.parse(calls[calls.length - 1][1].body)
  return body.action === 'set-enabled-plugins' ? body.enabledPlugins : null
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({}),
  }))
  // Everything on, so Commerce genuinely has a dependent to strand.
  mockOrg = { $id: ORG_ID, enabledPlugins: ['mui', 'commerce', 'accounts'] }
})

describe('org Plugins page — disable cascade (AGL-2486)', () => {
  it('warns before disabling Commerce and names User Accounts', async () => {
    render(<OrgPlugins />)
    flipOff('Toggle Commerce')
    await waitFor(() => expect(continueButton()).toBeTruthy())
    expect(
      document.body.textContent?.includes(
        'Disabling Commerce also disables 1 other plugin',
      ),
    ).toBe(true)
    expect(document.body.textContent?.includes('User Accounts')).toBe(true)
  })

  it('says the disable lands on every site in the workspace', async () => {
    render(<OrgPlugins />)
    flipOff('Toggle Commerce')
    await waitFor(() => expect(continueButton()).toBeTruthy())
    expect(
      document.body.textContent?.includes(
        'This applies to every site in the workspace.',
      ),
    ).toBe(true)
  })

  it('writes NOTHING while the dialog is open', async () => {
    render(<OrgPlugins />)
    flipOff('Toggle Commerce')
    await waitFor(() => expect(continueButton()).toBeTruthy())
    // This page saves on change. If the write had already gone, the dialog
    // would be describing something that had happened, not offering a choice.
    expect(savedSet()).toBeNull()
  })

  it('does not warn when nothing depends on the plugin', async () => {
    mockOrg = { $id: ORG_ID, enabledPlugins: ['mui', 'commerce', 'redirects'] }
    render(<OrgPlugins />)
    flipOff('Toggle Redirects')
    await waitFor(() => expect(savedSet()).not.toBeNull())
    expect(continueButton()).toBeUndefined()
    // `forms` rides every save the way `mui` does: both are always-on, so
    // `resolveEnabledPlugins` unions them in before the toggle subtracts.
    expect(savedSet()).toEqual(['mui', 'forms', 'commerce'])
  })

  describe('Cancel', () => {
    it('writes nothing', async () => {
      render(<OrgPlugins />)
      flipOff('Toggle Commerce')
      await waitFor(() => expect(continueButton()).toBeTruthy())
      fireEvent.click(cancelButton() as HTMLElement)
      expect(savedSet()).toBeNull()
    })

    it('leaves the switch ON rather than only appearing to revert', async () => {
      render(<OrgPlugins />)
      flipOff('Toggle Commerce')
      await waitFor(() => expect(continueButton()).toBeTruthy())
      fireEvent.click(cancelButton() as HTMLElement)
      // The switch is controlled by the org doc, which never moved.
      await waitFor(() =>
        expect(switchFor('Toggle Commerce').checked).toBe(true),
      )
      expect(switchFor('Toggle User Accounts').checked).toBe(true)
    })

    it('closes the dialog', async () => {
      render(<OrgPlugins />)
      flipOff('Toggle Commerce')
      await waitFor(() => expect(continueButton()).toBeTruthy())
      fireEvent.click(cancelButton() as HTMLElement)
      await waitFor(() => expect(continueButton()).toBeUndefined())
    })
  })

  describe('Continue', () => {
    it('removes the plugin AND its dependent in ONE request', async () => {
      render(<OrgPlugins />)
      flipOff('Toggle Commerce')
      await waitFor(() => expect(continueButton()).toBeTruthy())
      fireEvent.click(continueButton() as HTMLElement)

      await waitFor(() => expect(savedSet()).not.toBeNull())
      // `set-enabled-plugins` REPLACES the array, so one request carries the
      // whole cascade — there is no window in which Commerce is off while
      // User Accounts still believes it can use it.
      expect(savedSet()).toEqual(['mui', 'forms'])
      const settingsCalls = (globalThis.fetch as jest.Mock).mock.calls.filter(
        ([url]) => url === '/api/orgs/settings',
      )
      expect(settingsCalls).toHaveLength(1)
    })
  })
})
