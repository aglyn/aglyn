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

import { act, fireEvent, render, screen } from '@testing-library/react'
import BesignerDraftAlertComponent from '../components/besigner-draft-alert.component'
import {
  besignerDraftKey,
  readBesignerDraft,
  writeBesignerDraft,
  type BesignerDraftIds,
} from '../drafts/besigner-draft-store'
import useBesignerDraft, { type BesignerDraftState } from './use-besigner-draft'

/**
 * The canvas is a mobx singleton with own, non-configurable computeds, so it
 * is stubbed rather than spied on — the same approach `use-besigner-document`
 * takes. `hasRemoteEdits` is modelled because it is the whole question here:
 * a double that always answered false would report the co-edited case green
 * whatever the hook did.
 */
const mockCanvas = {
  isInitialSame: true,
  didSetInitial: true,
  hasRemoteEdits: false,
  applyNodes: jest.fn(),
  toJSON: jest.fn(() => ({ nodes: { root: {} } })),
}

jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return new Proxy(actual, {
    get: (target, prop) =>
      prop === 'canvas' ? mockCanvas : Reflect.get(target, prop),
  })
})

/**
 * What the crash net may and may not do once a document is shared
 * (AGL-2486).
 *
 * Zach, testing two browsers on one screen: *"if we come into a working
 * session we should be seeing the draft everyone is working on, and
 * restoring a draft probably would cause issues?"* — and it does. Restoring
 * is a whole-map replace which the co-edit mirror publishes verbatim, so on
 * the running editor a peer's freshly created node was deleted on the peer's
 * own screen, and a stale restore reverted a colleague's SAVED work in a way
 * that survived the reload the conflict banner asks for.
 *
 * The shared unsaved state is the mirror; this draft is the private one. So
 * the offer stands only while restoring is a private act.
 */
describe('useBesignerDraft restore verdict (AGL-2486)', () => {
  const IDS: BesignerDraftIds = {
    scope: 'host-1',
    kind: 'screen',
    docId: 'screen-1',
    versionId: 'v1',
  }
  const DRAFT_NODES = {
    root: { $id: 'root', componentId: 'div', nodes: ['a'] },
    a: { $id: 'a', componentId: 'muiTypography', parentId: 'root' },
  } as never

  function seedDraft(baseStamp: string | null) {
    writeBesignerDraft(IDS, { nodes: DRAFT_NODES, baseStamp })
  }

  function setup(storedStamp: string | null) {
    const seen: BesignerDraftState[] = []
    function Harness() {
      const draft = useBesignerDraft({
        ids: IDS,
        loaded: true,
        // Dirty, so the "returned to the saved state" cleanup does not
        // delete the very draft under test.
        dirty: true,
        storedStamp,
      })
      seen.push(draft)
      return <BesignerDraftAlertComponent draft={draft} noun="screen" />
    }
    const rendered = render(<Harness />)
    return { ...rendered, state: () => seen[seen.length - 1] }
  }

  beforeEach(() => {
    localStorage.clear()
    mockCanvas.applyNodes.mockClear()
    mockCanvas.hasRemoteEdits = false
    mockCanvas.isInitialSame = true
  })

  it('offers the restore when the canvas is the author’s alone', () => {
    seedDraft('ms:100')
    const { state } = setup('ms:100')

    expect(state().available).toBe(true)
    expect(state().restoreBlockedBy).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    expect(mockCanvas.applyNodes).toHaveBeenCalledWith(DRAFT_NODES)
  })

  it('withholds it when someone else saved after the draft was taken', () => {
    seedDraft('ms:100')
    const { state } = setup('ms:200')

    expect(state().restoreBlockedBy).toBe('saved-since')
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
    // Reload is offered instead — this banner is now standing in for the
    // conflict one rather than contradicting it.
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()

    // And the action agrees with the offer, not just the button.
    act(() => state().restore())
    expect(mockCanvas.applyNodes).not.toHaveBeenCalled()
  })

  it('withholds it while a co-editor’s work is on the canvas', () => {
    seedDraft('ms:100')
    mockCanvas.hasRemoteEdits = true
    const { state } = setup('ms:100')

    expect(state().restoreBlockedBy).toBe('live-session')
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
    // No save has happened, so there is nothing to reload for.
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()

    act(() => state().restore())
    expect(mockCanvas.applyNodes).not.toHaveBeenCalled()
  })

  it('still lets the author discard a draft it will not restore', () => {
    seedDraft('ms:100')
    const { state } = setup('ms:200')
    expect(readBesignerDraft(IDS)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(localStorage.getItem(besignerDraftKey(IDS))).toBeNull()
    expect(state().available).toBe(false)
  })
})
