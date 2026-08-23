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
 * The per-site User Accounts switch is reachable from the console
 * (AGL-2486), on the card that already holds every other per-site plugin
 * toggle.
 *
 * A capability that exists only in code is not shipped: without this row, a
 * site whose member pages 404 would have no way to turn them back on, and
 * the marketing-site fix would read as an outage. The row therefore has to
 * behave the OPPOSITE way round from its neighbours — unchecked when the
 * host doc says nothing — and it writes a different field, so both halves
 * are asserted here rather than assumed from the sibling rows.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SitePluginsCard from '../components/site-plugins-card.component'

const mockHost = {
  data: { $id: 'host-1' } as unknown as Record<string, unknown>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}
const mockSetDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({ doc: mockHost, setDoc: mockSetDoc }),
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

/**
 * By `aria-label` rather than `getByRole('checkbox', …)`: MUI's Switch puts
 * the label on the inner input, which the role query does not resolve here.
 * Both helpers THROW when the switch is absent, so a missing row still fails
 * loudly rather than reading as "unchecked".
 */
const switchFor = (label: string): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="Toggle ${label} on this site"]`,
  )
  if (!input) throw new Error(`No "${label}" switch on the card`)
  return input
}

const accountsSwitch = () => switchFor('User Accounts')

const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save site plugins' }))

describe('SitePluginsCard — User Accounts row (AGL-2486)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHost.fromCache = false
    mockHost.status = 'success'
    mockHost.data = { $id: 'host-1' }
  })

  it('offers the switch at all', () => {
    render(<SitePluginsCard hostId="host-1" />)
    expect(accountsSwitch()).toBeTruthy()
  })

  it('reads OFF on a site that never opted in', () => {
    // The inversion. Every other row on this card is checked when the host
    // doc says nothing; this one must not be, or the console would report a
    // marketing site as serving member pages it does not serve.
    render(<SitePluginsCard hostId="host-1" />)
    expect(accountsSwitch().checked).toBe(false)
  })

  it('reads ON for a site that has opted in', () => {
    mockHost.data = { $id: 'host-1', enabledPlugins: ['accounts'] }
    render(<SitePluginsCard hostId="host-1" />)
    expect(accountsSwitch().checked).toBe(true)
  })

  it('turning it ON writes the OPT-IN list, not the deny-list', () => {
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(accountsSwitch())
    save()

    return waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledTimes(1)
      const [payload, options] = mockSetDoc.mock.calls[0]
      expect(payload.enabledPlugins).toEqual(['accounts'])
      // And it must not have quietly disabled it at the same time.
      expect(payload.disabledPlugins).toEqual([])
      // Both fields ride one atomic replace: saving only one of them would
      // leave the other holding a value from a different edit.
      expect(options).toEqual({
        mergeFields: ['disabledPlugins', 'enabledPlugins'],
      })
    })
  })

  it('turning it OFF again removes the opt-in', async () => {
    mockHost.data = { $id: 'host-1', enabledPlugins: ['accounts'] }
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(accountsSwitch())
    save()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [payload] = mockSetDoc.mock.calls[0]
    expect(payload.enabledPlugins).toEqual([])
  })

  it('an ordinary row still writes the DENY-list', async () => {
    // The regression fence: the second field must not have changed how the
    // other twelve toggles persist.
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(switchFor('Commerce'))
    save()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [payload] = mockSetDoc.mock.calls[0]
    expect(payload.disabledPlugins).toEqual(['commerce'])
    expect(payload.enabledPlugins).toEqual([])
  })

  it('the stale-seed guard still stands in front of the opt-in write', async () => {
    // The AGL-1358 guard wraps the whole save, and this write is the one
    // that decides whether `/signin` exists on a live site — so it must not
    // be the write that slipped out from behind it.
    mockHost.fromCache = true
    render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(accountsSwitch())
    save()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
  })
})
