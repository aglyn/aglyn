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
import BesignerDraftAlertComponent, {
  describeDraftOffer,
} from '../components/besigner-draft-alert.component'
import {
  besignerDraftKey,
  readBesignerDraft,
  writeBesignerDraft,
  type BesignerDraftIds,
} from '../drafts/besigner-draft-store'
import useBesignerDraft, {
  recoverableRoomSessions,
  type BesignerDraftState,
} from './use-besigner-draft'

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

/** The SHARED working draft's document — the other store an offer can come from. */
const mockReadServerDraft = jest.fn(async () => null as unknown)
const mockClearServerDraft = jest.fn(async () => undefined)

jest.mock('../drafts/besigner-server-draft', () => ({
  writeServerDraft: jest.fn(async () => 'written'),
  readServerDraft: (...args: unknown[]) => mockReadServerDraft(...(args as [])),
  clearServerDraft: (...args: unknown[]) =>
    mockClearServerDraft(...(args as [])),
}))

/**
 * What the crash net may and may not do once a document is shared
 * (AGL-2486).
 *
 * Restoring is a whole-map replace, and the co-edit mirror publishes it
 * verbatim. In a shared room that deletes a peer's freshly created node on
 * the peer's own screen, and a stale restore reverts a colleague's SAVED work
 * in a way that survives the reload the conflict banner asks for.
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

  function setup(storedStamp: string | null, roomSessions?: number | null) {
    const seen: BesignerDraftState[] = []
    function Harness() {
      const draft = useBesignerDraft({
        ids: IDS,
        loaded: true,
        // Dirty, so the "returned to the saved state" cleanup does not
        // delete the very draft under test.
        dirty: true,
        storedStamp,
        roomSessions,
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
    mockReadServerDraft.mockClear()
    mockReadServerDraft.mockResolvedValue(null)
    mockClearServerDraft.mockClear()
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
    // No Reload, because nothing here is stale: the save landed before this
    // session opened, so the canvas already holds it and saving is not
    // paused. Offering the way out of a conflict, over a document with no
    // conflict, is what sent an author reloading to find a colleague who
    // was never there.
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(screen.getByRole('alert').textContent).not.toContain(
      'saving is paused',
    )

    // And the action agrees with the offer, not just the button.
    act(() => state().restore())
    expect(mockCanvas.applyNodes).not.toHaveBeenCalled()
  })

  /**
   * The same stranded draft, but with a colleague's save landing DURING this
   * session. Now saving really is paused and a reload really is the way out,
   * so the banner says so — and the difference between the two is the whole
   * point of splitting the copy.
   */
  it('says saving is paused only when a save landed while editing', () => {
    seedDraft('ms:100')
    const seen: BesignerDraftState[] = []
    function Harness() {
      const draft = useBesignerDraft({
        ids: IDS,
        loaded: true,
        dirty: true,
        storedStamp: 'ms:200',
      })
      seen.push(draft)
      return (
        <BesignerDraftAlertComponent draft={draft} noun="screen" remoteChanged />
      )
    }
    render(<Harness />)

    expect(seen[seen.length - 1]?.restoreBlockedBy).toBe('saved-since')
    expect(screen.getByRole('alert').textContent).toContain('saving is paused')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('reaches the shared draft when the author discards the offer', async () => {
    // The offer came from the SHARED store, which is where a "less than a
    // minute ago" draft on a five-day-old document comes from. Clearing only
    // localStorage leaves it there to be offered again on the next load, and
    // on every load after that: a question the author cannot stop being
    // asked.
    mockReadServerDraft.mockResolvedValueOnce({
      nodes: DRAFT_NODES,
      baseStamp: 'ms:100',
      updatedByUid: null,
      updatedByEmail: null,
    })
    const firestore = {} as never
    const seen: BesignerDraftState[] = []
    function Harness() {
      const draft = useBesignerDraft({
        ids: IDS,
        firestore,
        loaded: true,
        dirty: true,
        storedStamp: 'ms:100',
      })
      seen.push(draft)
      return <BesignerDraftAlertComponent draft={draft} noun="screen" />
    }
    render(<Harness />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(seen[seen.length - 1]?.available).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(mockClearServerDraft).toHaveBeenCalledWith(firestore, IDS)
  })

  it('says nothing at all while a co-editor’s work is on the canvas', () => {
    seedDraft('ms:100')
    mockCanvas.hasRemoteEdits = true
    const { state } = setup('ms:100')

    // Not a blocked Restore beside a live Discard — no prompt at all. A
    // canvas the mirror has already written to is not a canvas anybody is
    // recovering, so there is nothing for the banner to offer (AGL-2486).
    expect(state().available).toBe(false)
    expect(state().restoreBlockedBy).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()

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
    // It deletes the draft and nothing else: not the canvas, not the mirror,
    // not the stored document. Pressed on a shared canvas, nothing anyone
    // can see changes. The hazard was never that it destroyed other people's
    // work — it is that a prompt offering to destroy work appears over a
    // canvas that is not this author's alone (AGL-2486).
    expect(mockCanvas.applyNodes).not.toHaveBeenCalled()
  })
})

/**
 * Whether the prompt appears AT ALL (AGL-2486).
 *
 * A recovery prompt is only ever correct for someone who lost a session of
 * their own — a crash, a closed browser, a dropped connection. Open a third
 * tab onto a document two other tabs are editing unsaved and the same prompt
 * offers to throw away work several people are in the middle of.
 *
 * So these cases are about the ROOM, not about which button is drawn. The
 * pair that matters is the last two: a shared room gets nothing, and a
 * person alone after a crash still gets everything — because withholding
 * recovery from them would break the only case the feature was built for.
 */
describe('useBesignerDraft room suppression (AGL-2486)', () => {
  const IDS: BesignerDraftIds = {
    scope: 'host-1',
    kind: 'screen',
    docId: 'screen-2',
    versionId: 'v1',
  }
  const DRAFT_NODES = { root: { $id: 'root', componentId: 'div' } } as never

  function setup(roomSessions?: number | null) {
    const seen: BesignerDraftState[] = []
    function Harness() {
      const draft = useBesignerDraft({
        ids: IDS,
        loaded: true,
        dirty: true,
        storedStamp: 'ms:100',
        roomSessions,
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
    writeBesignerDraft(IDS, { nodes: DRAFT_NODES, baseStamp: 'ms:100' })
  })

  it('says nothing while presence has not answered yet', () => {
    const { state } = setup(null)

    expect(state().available).toBe(false)
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
  })

  it('says nothing when another session is in the room', () => {
    const { state } = setup(1)

    expect(state().available).toBe(false)
    // Not "Restore withheld, Discard offered" — no prompt at all. In a shared
    // room there is nothing Discard can usefully do, so offering it only
    // invites someone to answer a question that should not have been asked.
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })

  it('says nothing when the mirror has already replayed work here', () => {
    // Presence reports an empty room — everyone who was here has closed —
    // but their unsaved work came back on join and is on the canvas now.
    mockCanvas.hasRemoteEdits = true
    const { state } = setup(0)

    expect(state().available).toBe(false)
  })

  it('keeps the draft on disk while it is unofferable', () => {
    setup(2)

    // Suppressing the offer must not reap the crash net of the tab still
    // holding the work.
    expect(readBesignerDraft(IDS)).not.toBeNull()
  })

  it('still offers everything to someone alone after a crash', () => {
    const { state } = setup(0)

    expect(state().available).toBe(true)
    expect(state().restoreBlockedBy).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(mockCanvas.applyNodes).toHaveBeenCalledWith(DRAFT_NODES)
  })

  it('still offers everything where there is no presence at all', () => {
    // The system-email besigner has no room; omitting the option must not
    // read as "unknown" and silence the crash net there.
    const { state } = setup(undefined)

    expect(state().available).toBe(true)
  })
})

/**
 * The presence status → room-size mapping, asserted directly because the
 * two ends of it pull in opposite directions: guessing "shared" while
 * presence is still connecting only delays an offer, while guessing
 * "shared" for a deployment that has no presence at all would withhold
 * recovery permanently.
 */
describe('recoverableRoomSessions (AGL-2486)', () => {
  it('reports the room once presence is live', () => {
    expect(recoverableRoomSessions('live', 0)).toBe(0)
    expect(recoverableRoomSessions('live', 3)).toBe(3)
  })

  it('reports unknown while presence is still arriving', () => {
    expect(recoverableRoomSessions('idle', 0)).toBeNull()
    expect(recoverableRoomSessions('connecting', 0)).toBeNull()
  })

  it('reports an empty room when presence cannot answer at all', () => {
    // No Realtime Database means no co-edit mirror either, so nothing can
    // have already restored the work — and the crash net must still run.
    expect(recoverableRoomSessions('unconfigured', 0)).toBe(0)
    expect(recoverableRoomSessions('unauthorized', 0)).toBe(0)
    expect(recoverableRoomSessions('error', 0)).toBe(0)
  })
})

/**
 * WHICH unsaved state the author is looking at (AGL-2508).
 *
 * The banner served one sentence for two different documents. Pressing
 * `Save draft`, being told "Draft saved", and coming back to "Unsaved
 * changes … were recovered from this browser" says the save failed and the
 * browser caught it — wrong on both counts, and the reasonable reading is
 * that the editor loses work.
 */
describe('describeDraftOffer origin (AGL-2508)', () => {
  const base = {
    available: true,
    takenAt: Date.now(),
    staleAgainstDocument: false,
    restoreBlockedBy: null,
    restore: () => undefined,
    discard: () => undefined,
  }
  const shared: BesignerDraftState = { ...base, origin: 'shared' }
  const browser: BesignerDraftState = { ...base, origin: 'browser' }

  it('never calls a SAVED draft unsaved, or blames the browser for it', () => {
    const copy = describeDraftOffer(shared, 'screen', Date.now())
    expect(copy).not.toMatch(/unsaved/i)
    expect(copy).not.toMatch(/this browser/i)
    expect(copy).toMatch(/saved draft/i)
    // It is on the server, so it is not this person's private copy.
    expect(copy).toMatch(/stored with the site/i)
  })

  it('still describes the crash net as the crash net', () => {
    const copy = describeDraftOffer(browser, 'screen', Date.now())
    expect(copy).toMatch(/Unsaved changes/)
    expect(copy).toMatch(/recovered from this browser/)
  })

  it('opens a saved draft and restores unsaved work', () => {
    render(<BesignerDraftAlertComponent draft={shared} noun="screen" />)
    expect(screen.getByRole('button', { name: 'Open draft' })).toBeTruthy()
    screen.unmount?.()
  })

  it('offers Restore for the browser crash net', () => {
    render(<BesignerDraftAlertComponent draft={browser} noun="screen" />)
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
  })
})
