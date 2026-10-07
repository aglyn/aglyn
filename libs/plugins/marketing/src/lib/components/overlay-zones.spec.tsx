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
 * The two zones the overlays list hosts (AGL-3603), drawn through a stand-in
 * for the shell's renderer.
 *
 * What it proves: each zone is drawn where it says — beside New bar and New
 * popup, in the empty list, and among the editor's fields — with the limits
 * and the trigger catalog; a proposal fills the editor's own fields and writes
 * nothing; and a created overlay goes through this plugin's site-wide write,
 * switched off and cut to the limits, then opens in the editor.
 */

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostOverlaysCard from './host-overlays-card.component'
import { OVERLAY_COPY_LIMITS, OVERLAY_POPUP_TRIGGERS } from '../model'

let overlayDocs: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/site-wide-change-double')
    .siteWideChangeThroughSdk(() => jest.requireMock('firebase/firestore')),
)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: null }),
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: overlayDocs, status: 'success', fromCache: false }),
  useHostActivityLogger: () => mockLogActivity,
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))

const mockLogActivity = jest.fn()

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: () => 'overlays',
  query: (name: string) => name,
  limit: () => undefined,
  orderBy: () => undefined,
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  deleteDoc: jest.fn(),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))

const ORG = { plan: 'business' } as never

/** Every zone call, by slot, with the props it was handed. */
const zoneCalls: Array<{ slot: string } & Record<string, any>> = []

/** The shell's renderer, standing in: one button per zone that calls its door. */
function ZoneRenderer(props: { slot: string } & Record<string, any>) {
  zoneCalls.push(props)
  if (props.slot === 'hostOverlays') {
    return (
      <button
        type="button"
        onClick={() =>
          void props.createOverlayDraft('popup', {
            name: 'Free call popup',
            headline: 'Book a free call',
            body: 'x'.repeat(900),
            ctaLabel: 'Book now',
            trigger: 'teleport',
            triggerValue: 5,
          })
        }
      >
        {'widget in hostOverlays'}
      </button>
    )
  }
  if (props.slot === 'overlayEditor') {
    return (
      <button
        type="button"
        onClick={() =>
          props.proposeValues(
            { headline: 'Proposed headline', body: 'Proposed body', trigger: 'scroll', triggerValue: 250 },
            'job-1',
          )
        }
      >
        {'widget in overlayEditor'}
      </button>
    )
  }
  return null
}

const renderCard = () =>
  render(
    <ConsoleWidgetSlotContext.Provider value={ZoneRenderer}>
      <HostOverlaysCard hostId="host-1" org={ORG} />
    </ConsoleWidgetSlotContext.Provider>,
  )

beforeEach(() => {
  jest.clearAllMocks()
  zoneCalls.length = 0
  overlayDocs = []
})

describe('the overlays list’s zones (AGL-3603)', () => {
  it('draws hostOverlays beside New bar and New popup, and again in the empty list, with the rules', () => {
    renderCard()
    expect(screen.getAllByRole('button', { name: 'widget in hostOverlays' })).toHaveLength(2)
    const call = zoneCalls.find((entry) => entry.slot === 'hostOverlays')
    expect(call?.hostId).toBe('host-1')
    expect(call?.limits).toBe(OVERLAY_COPY_LIMITS)
    expect(call?.triggers).toBe(OVERLAY_POPUP_TRIGGERS)
  })

  it('draws it once beside the buttons when the list has overlays', () => {
    overlayDocs = [{ $id: 'ov-1', kind: 'bar', name: 'Spring', enabled: true, bar: { text: 'Spring sale' } }]
    renderCard()
    expect(screen.getAllByRole('button', { name: 'widget in hostOverlays' })).toHaveLength(1)
  })

  it('writes a created overlay switched off, cut to the limits, and opens it in the editor', async () => {
    renderCard()
    fireEvent.click(screen.getAllByRole('button', { name: 'widget in hostOverlays' })[0])

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [ref, stored] = (setDoc as jest.Mock).mock.calls[0]
    expect(ref.path).toMatch(/^hosts\/host-1\/overlays\//)
    expect(stored).toMatchObject({
      kind: 'popup',
      enabled: false,
      name: 'Free call popup',
      popup: { headline: 'Book a free call', ctaLabel: 'Book now', trigger: 'delay' },
    })
    expect(stored.popup.body).toHaveLength(OVERLAY_COPY_LIMITS.body)
    expect(mockLogActivity).toHaveBeenCalledWith('Created overlay', expect.objectContaining({ type: 'content' }))
    // Opened for a person to read, link and switch on.
    expect(await screen.findByText('Edit overlay')).toBeTruthy()
    expect(screen.getByDisplayValue('Book a free call')).toBeTruthy()
  })

  it('draws overlayEditor in the editor, and a proposal fills its fields without a write', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'New popup' }))
    const call = zoneCalls.filter((entry) => entry.slot === 'overlayEditor').at(-1)
    expect(call).toMatchObject({ hostId: 'host-1', overlayId: '', kind: 'popup' })
    expect(call?.copy).toMatchObject({ headline: '', body: '', trigger: 'delay', triggerValue: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'widget in overlayEditor' }))
    expect(await screen.findByDisplayValue('Proposed headline')).toBeTruthy()
    expect(screen.getByDisplayValue('Proposed body')).toBeTruthy()
    // The scroll depth is held inside its range.
    expect(screen.getByDisplayValue('100')).toBeTruthy()
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('draws neither zone outside the console shell', () => {
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)
    expect(screen.queryByRole('button', { name: /widget in/ })).toBeNull()
  })
})
