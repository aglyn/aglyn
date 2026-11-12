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
 * A site's Admin › Plugins saves on the FIRST press (AGL-4047).
 *
 * Seen in production on v1.20.2: right after the page loaded, "Save site
 * plugins" was refused with "We could not confirm your site plugin list with
 * the server yet, so nothing was saved", twice out of two, and a press a few
 * seconds later saved. The host read was still the shared cache's copy, so the
 * press waited on the server's confirmation (AGL-4120) and was refused when
 * that ran past its deadline.
 *
 * The card now holds Save, with the reason beside it, until the server has
 * confirmed the list, and the moves made meanwhile are applied to the list the
 * server confirms. That second half is what keeps the guard's protection: a
 * plugin switched off since the cached snapshot must not be switched back on
 * by a save that never mentioned it.
 *
 * The real guard and the real confirmation record run here, with a short
 * deadline, so the press-and-refuse path is the production one.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  createListenHandle,
  setSeedConfirmWaitMs,
  trackListenConfirmation,
  type ListenConfirmation,
} from '@aglyn/tenant-feature-instance/hooks/helpers/listen-confirmation'
import type { ReactNode } from 'react'
import SitePluginsCard from '../components/site-plugins-card.component'

/** The setter's options with the site-wide outbox stager taken out (AGL-3386). */
function withoutSiteWideEntry(call: any[]): any[] {
  const [payload, options] = call as [unknown, Record<string, unknown> | undefined]
  if (!options || !('alongside' in options)) return call
  const { alongside: _entry, ...rest } = options
  return [payload, Object.keys(rest).length ? rest : undefined]
}

const mockHost = {
  data: { $id: 'host-1', disabledPlugins: ['commerce'] } as unknown,
  status: 'success' as 'success' | 'error',
  fromCache: true,
  listen: createListenHandle(),
}
const mockSetDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({ doc: mockHost, setDoc: mockSetDoc }),
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: [] }),
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
  // The REAL guard: a stub would let the write through whatever the card did.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/firebase/firebase-services', () => ({
  useFirestore: () => jest.requireMock('@aglyn/tenant-feature-instance').useFirestore(),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-firestore-collection', () => {
  const useFirestoreCollection = (...args: unknown[]) =>
    jest.requireMock('@aglyn/tenant-feature-instance').useFirestoreCollection(...args)
  return { __esModule: true, default: useFirestoreCollection, useFirestoreCollection }
})

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ children, href }: { children: ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => <span aria-hidden="true" />,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business' } }),
}))

const saveButton = () =>
  screen.getByRole('button', { name: 'Save site plugins' }) as HTMLButtonElement

/** Press Save the way a person does: only when it can be pressed. */
const pressSave = () => {
  if (!saveButton().disabled) fireEvent.click(saveButton())
}

/**
 * Commerce's switch. The site has it off, so the move is a switch ON, which
 * asks nothing first (only a disable can open the cascade dialog).
 */
const commerceSwitch = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Toggle Commerce on this site"]',
  )
  if (!input) throw new Error('No Commerce switch on the card')
  return input
}

/** A deadline far shorter than production's 12 s, past which a press refuses. */
const DEADLINE_MS = 50

let confirmation: ListenConfirmation

/** The server answers the host read, with `data`. */
function serverConfirms(
  data: unknown,
  changed: boolean,
  rerender: (ui: JSX.Element) => void,
) {
  mockHost.data = data
  mockHost.fromCache = false
  confirmation.report(false, changed)
  rerender(<SitePluginsCard hostId="host-1" />)
}

beforeAll(() => setSeedConfirmWaitMs(DEADLINE_MS))
afterAll(() => setSeedConfirmWaitMs())

beforeEach(() => {
  jest.clearAllMocks()
  mockHost.data = { $id: 'host-1', disabledPlugins: ['commerce'] }
  mockHost.status = 'success'
  mockHost.fromCache = true
  mockHost.listen = createListenHandle()
  // The listener behind the read, unconfirmed, as after a page load on the
  // shared cache.
  confirmation = trackListenConfirmation(mockHost.listen)
  confirmation.report(true)
})

afterEach(() => confirmation.close())

describe('Admin › Plugins, first save after a page load (AGL-4047)', () => {
  it('keeps a press made while the list is held, and saves it once the server answers', async () => {
    const { rerender } = render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())

    // Pressed straight away, while the read is still the cache's: kept, not
    // dropped (AGL-4047), and answered at once.
    pressSave()
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
    expect(mockSetDoc).not.toHaveBeenCalled()

    serverConfirms({ $id: 'host-1', disabledPlugins: ['commerce'] }, false, rerender)

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Site plugins saved', {
        variant: 'success',
      }),
    )
    expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1)
  })

  it('refuses a kept press in the guard’s words when no answer comes, and the next press saves', async () => {
    const { rerender } = render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    pressSave()
    // Past the guard's wait, with no answer: the press ends refused, here.
    await new Promise((resolve) => setTimeout(resolve, DEADLINE_MS * 3))
    expect(screen.getByRole('alert').textContent).toMatch(
      /^We could not confirm your site plugin list with the server yet, so nothing was saved/,
    )
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(false)

    serverConfirms({ $id: 'host-1', disabledPlugins: ['commerce'] }, false, rerender)
    expect(screen.queryByRole('status')).toBeNull()
    pressSave()
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
  })

  it('applies a move made before the server answered to the list the server confirmed', async () => {
    const { rerender } = render(<SitePluginsCard hostId="host-1" />)
    fireEvent.click(commerceSwitch())
    expect(commerceSwitch().checked).toBe(true)

    // Since the cached snapshot, another plugin was switched off on this
    // site. The reader never touched it, so the save must not turn it on.
    serverConfirms(
      { $id: 'host-1', disabledPlugins: ['commerce', 'switched-off-elsewhere'] },
      true,
      rerender,
    )
    // The reader's own move survives the confirmation.
    expect(commerceSwitch().checked).toBe(true)
    pressSave()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [payload] = withoutSiteWideEntry(mockSetDoc.mock.calls[0])
    expect(payload.disabledPlugins).toEqual(['switched-off-elsewhere'])
  })
})
