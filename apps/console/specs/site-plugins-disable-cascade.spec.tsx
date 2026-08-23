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
 * Disabling a plugin another one depends on warns first (AGL-2486), on the
 * PER-SITE card.
 *
 * Zach: "if we turn off a plugin that another plugin depends on it warn the
 * user that by disabling that plugin it will also disable said plugin because
 * it depends on it, give them the option to cancel, or continue with disabling
 * the dependent plugins".
 *
 * The case that made this real: the Members blocks and every `membership/*`
 * API handler ship inside the COMMERCE bundle, so Commerce off leaves a site
 * still routing `/signin` — member pages gate on `accounts`, the API gates on
 * `commerce` — with nothing able to answer the login POST.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SitePluginsCard from '../components/site-plugins-card.component'

const mockHost = {
  data: { $id: 'host-1', enabledPlugins: ['accounts'] } as unknown as Record<
    string,
    unknown
  >,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}
const mockSetDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({ doc: mockHost, setDoc: mockSetDoc }),
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business' } }),
}))

const switchFor = (label: string): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="Toggle ${label} on this site"]`,
  )
  if (!input) throw new Error(`No "${label}" switch on the card`)
  return input
}

const commerceSwitch = () => switchFor('Commerce')
const accountsSwitch = () => switchFor('User Accounts')

const continueButton = () =>
  screen.getByRole('button', { name: 'Continue and disable those too' })
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' })
/**
 * By DOM query, not `getByRole`: MUI's Dialog marks the rest of the app
 * `aria-hidden` while it is open and for the width of its close transition,
 * and a role query skips hidden subtrees — so the Save button is invisible to
 * `getByRole` right after Cancel or Continue. It still throws when absent.
 */
const save = () => {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === 'Save site plugins',
  )
  if (!button) throw new Error('No "Save site plugins" button on the card')
  fireEvent.click(button)
  return button
}

describe('SitePluginsCard — disable cascade (AGL-2486)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHost.fromCache = false
    mockHost.status = 'success'
    // The site has opted INTO User Accounts, so it depends on Commerce.
    mockHost.data = { $id: 'host-1', enabledPlugins: ['accounts'] }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        placements: 3,
        affectedScreens: 2,
        truncated: false,
      }),
    }) as unknown as typeof fetch
  })

  it('warns before disabling Commerce, and names User Accounts', async () => {
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())

    expect(
      screen.getByText(
        'Disabling Commerce also disables 1 other plugin',
      ),
    ).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByText('User Accounts — depends on Commerce'),
      ).toBeTruthy(),
    )
    // And the plugin actually switched off is named too, with its own row.
    expect(
      screen.getByText('Commerce (the one you switched off)'),
    ).toBeTruthy()
  })

  it('does not warn when nothing depends on the plugin', () => {
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(switchFor('Redirects'))
    expect(
      screen.queryByRole('button', { name: 'Continue and disable those too' }),
    ).toBeNull()
  })

  it('does not warn when the dependent is already off', () => {
    // No opt-in, so User Accounts is already off for this site and cascading
    // it would overstate the consequence.
    mockHost.data = { $id: 'host-1' }
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    expect(
      screen.queryByRole('button', { name: 'Continue and disable those too' }),
    ).toBeNull()
  })

  it('does not warn when turning a plugin ON', () => {
    mockHost.data = { $id: 'host-1', disabledPlugins: ['commerce'] }
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    expect(
      screen.queryByRole('button', { name: 'Continue and disable those too' }),
    ).toBeNull()
  })

  it('states the ELEMENT consequence with a real count, not a category', async () => {
    // "3 elements on 2 published pages will stop rendering" is a different
    // decision from "these blocks will no longer be offered".
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    await waitFor(() =>
      expect(
        screen.getByText('3 elements on 2 published pages will stop rendering.'),
      ).toBeTruthy(),
    )
  })

  it('says the count is a floor when the scan truncated', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        placements: 200,
        affectedScreens: 40,
        truncated: true,
      }),
    })
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    await waitFor(() =>
      expect(
        screen.getByText(
          'At least 200 elements on 40 published pages will stop rendering.',
        ),
      ).toBeTruthy(),
    )
  })

  it('falls back to the category sentence when the scan fails', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('nope'))
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    // It must not invent a number, and must not go silent about the risk.
    await waitFor(() =>
      expect(
        screen.getByText(
          'Elements already placed on published pages stop rendering.',
        ),
      ).toBeTruthy(),
    )
  })

  it('admits it can only see DECLARED dependencies', () => {
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    expect(
      screen.getByText(/cannot be detected, so check any third-party plugins/),
    ).toBeTruthy()
  })

  it('warns that re-enabling does not bring the cascaded plugins back', () => {
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    expect(screen.getByText(/does NOT switch these back on/)).toBeTruthy()
  })

  describe('Cancel', () => {
    it('leaves the switch ON', () => {
      render(<SitePluginsCard hostId="host-1" />)
      fireEvent.click(commerceSwitch())
      fireEvent.click(cancelButton())
      // Not "looks reverted" — the local state never moved, so the controlled
      // switch is genuinely still on.
      expect(commerceSwitch().checked).toBe(true)
      expect(accountsSwitch().checked).toBe(true)
    })

    it('writes nothing at all', async () => {
      render(<SitePluginsCard hostId="host-1" />)
      fireEvent.click(commerceSwitch())
      fireEvent.click(cancelButton())
      // Save is disabled while nothing is dirty, so no write can have gone.
      expect(save().disabled).toBe(true)
      await waitFor(() => expect(mockSetDoc).not.toHaveBeenCalled())
    })

    it('closes the dialog', async () => {
      render(<SitePluginsCard hostId="host-1" />)
      fireEvent.click(commerceSwitch())
      fireEvent.click(cancelButton())
      // Awaited because MUI's Dialog unmounts after its close transition, not
      // on the click — asserting synchronously would only pin the transition.
      await waitFor(() =>
        expect(
          screen.queryByRole('button', {
            name: 'Continue and disable those too',
          }),
        ).toBeNull(),
      )
    })
  })

  describe('Continue', () => {
    it('turns off both switches', () => {
      render(<SitePluginsCard hostId="host-1" />)
      fireEvent.click(commerceSwitch())
      fireEvent.click(continueButton())
      expect(commerceSwitch().checked).toBe(false)
      expect(accountsSwitch().checked).toBe(false)
    })

    it('persists the whole cascade in ONE write', async () => {
      render(<SitePluginsCard hostId="host-1" />)
      fireEvent.click(commerceSwitch())
      fireEvent.click(continueButton())
      save()

      await waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalledTimes(1)
        const [payload, options] = mockSetDoc.mock.calls[0]
        // Commerce lands in the deny-list; User Accounts is default-off per
        // site, so it goes off by LEAVING the opt-in list. One document, one
        // atomic replace of both fields — a half-applied cascade would be
        // worse than none.
        expect(payload.disabledPlugins).toEqual(['commerce'])
        expect(payload.enabledPlugins).toEqual([])
        expect(options).toEqual({
          mergeFields: ['disabledPlugins', 'enabledPlugins'],
        })
      })
    })
  })
})
