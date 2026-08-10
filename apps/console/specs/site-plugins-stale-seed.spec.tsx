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
 * The per-site plugin switchboard must not re-enable a plugin from a stale
 * seed (AGL-1358).
 *
 * The switch list is seeded from the host doc LISTENER and saved as the whole
 * `disabledPlugins` array. `mergeFields` replaces that array atomically —
 * deliberately, because a deep merge could never REMOVE an id — so a seed
 * that the server never confirmed does not merely lose an edit: it writes a
 * deny-list from which every recently-disabled plugin has vanished.
 *
 * That is a boundary, not a preference. `resolveHostEnabledPlugins` is the
 * single enforcement point for console navigation, the editor, published
 * pages and API dispatch, so a plugin switched back on here is running again
 * on a live site with nobody having asked for it — which is exactly the shape
 * the kill-switch work cares about.
 *
 * Both directions are asserted. The positive one matters most: this guard
 * stands in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SitePluginsCard from '../components/site-plugins-card.component'

const mockHost = {
  data: { $id: 'host-1', disabledPlugins: ['commerce'] } as unknown,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}
const mockSetDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({ doc: mockHost, setDoc: mockSetDoc }),
  // The REAL guard (AGL-1358). A stub would let the write through no matter
  // what the card passed it, which is the one thing this spec disproves.
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

const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save site plugins' }))

/** Flip any plugin so the Save button leaves its disabled state. */
const toggleFirstSwitch = () =>
  fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0])

describe('SitePluginsCard (AGL-1358)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHost.fromCache = false
    mockHost.status = 'success'
  })

  it('REFUSES to write the deny-list from an unconfirmed seed', async () => {
    mockHost.fromCache = true
    render(<SitePluginsCard hostId="host-1" />)

    toggleFirstSwitch()
    save()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('site plugin list'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The switches keep their positions and Save stays live, so the user can
    // retry rather than discover later that nothing was stored.
    expect(
      (screen.getByRole('button', { name: 'Save site plugins' }) as
        HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('SAVES the deny-list once the server has confirmed the seed', async () => {
    render(<SitePluginsCard hostId="host-1" />)

    toggleFirstSwitch()
    save()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [payload, options] = mockSetDoc.mock.calls[0]
    expect(Array.isArray(payload.disabledPlugins)).toBe(true)
    expect(options).toEqual({ mergeFields: ['disabledPlugins'] })
  })

  it('REFUSES when the host read failed outright, and says so differently', async () => {
    mockHost.status = 'error'
    render(<SitePluginsCard hostId="host-1" />)

    toggleFirstSwitch()
    save()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})
