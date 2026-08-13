/**
 * @jest-environment node
 */

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
 * AGL-1467: undo exists end to end, or it does not exist.
 *
 * The chain has four links and every one of them is invisible to a render
 * test: the delete route must leave a tombstone instead of destroying the
 * document, a restore route must exist to consume it, and both delete surfaces
 * in the library must put an Undo action on the snackbar that calls it. A
 * break anywhere leaves the product in the state AGL-1461 described and
 * refused to paper over — recovery wording with nothing behind it — except
 * now the wording would be there, which is worse than the honest copy it
 * replaced.
 *
 * Asserted over the DECLARATIONS, as the AGL-1413/AGL-1461/AGL-1462 specs in
 * this folder are: `MediaLibraryComponent` mounts a Firestore listener stack,
 * the org context, the DAM counters and a dnd-kit surface, so rendering it
 * would be a test of the mocks. The route halves are asserted the same way
 * because the alternative is booting Next's request pipeline to learn whether
 * one function is called.
 *
 * The BEHAVIOUR of the tombstone — generation capture, counter reversal, a
 * clean failure past the window — is proved by execution against the emulator
 * in `libs/tenant/data/admin/src/lib/server/media-tombstone.emulator.spec.ts`.
 * This spec only holds the wiring that emulator cannot see.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(__dirname, '..', '..', 'app', 'api', 'media')

const DELETE_ROUTE = readFileSync(join(API, 'upload', 'route.ts'), 'utf8')
const RESTORE_ROUTE = readFileSync(join(API, 'restore', 'route.ts'), 'utf8')
const LIBRARY = readFileSync(
  join(__dirname, 'media-library.component.tsx'),
  'utf8',
)

/**
 * Source with comments removed.
 *
 * Required rather than tidy: the DELETE branch's own comment NAMES the call it
 * replaced, which is the right thing for a reader and would make the negative
 * assertion below fail against prose. A structural spec has to look at code.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Just the DELETE branch of the upload route, so a failure prints one screen. */
function deleteBranch(): string {
  const source = code(DELETE_ROUTE)
  const start = source.indexOf("if (method === 'DELETE')")
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('const fileName = String(body?.fileName', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

/** The body of a `const <name> = useCallback(` declaration. */
function callbackBody(name: string): string {
  const start = LIBRARY.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const end = LIBRARY.indexOf('\n  )', start)
  expect(end).toBeGreaterThan(start)
  return LIBRARY.slice(start, end)
}

describe('the delete route leaves something to restore (AGL-1467)', () => {
  /**
   * The defect this issue exists for. `mediaRef.delete()` destroyed the id,
   * the file name, the folder, the tags, the alt text, the scope tokens, the
   * `cdnPath` and the `variants` — so the seven days of bytes GCS was holding
   * were unaddressable and an Undo button would have had nothing to call.
   */
  it('THE DEFECT: no bare document delete on the media path', () => {
    expect(deleteBranch()).not.toContain('.delete()')
  })

  it('routes the delete through the tombstone writer', () => {
    expect(deleteBranch()).toContain('deleteMediaWithTombstone')
  })

  /**
   * The counter arithmetic moved INTO the tombstone transaction, so the
   * decrement and the record of what to re-increment commit together. A
   * decrement left behind here would double-apply.
   */
  it('does not decrement the counter a second time on its own', () => {
    expect(deleteBranch()).not.toContain('increment(-1)')
  })
})

describe('the restore route (AGL-1467)', () => {
  it('exists and consumes the tombstone', () => {
    expect(RESTORE_ROUTE).toContain('restoreMediaFromTombstone')
  })

  /**
   * Same gate as the delete, because it is the same capability pointed the
   * other way. `resolveMediaScope` is where host `memberRoles` and the org
   * roster role are checked; a restore that skipped it would let anyone who
   * knows a media id write a document into somebody else's library.
   */
  it('authenticates and resolves the scope exactly as the delete does', () => {
    expect(RESTORE_ROUTE).toContain('verifyIdToken')
    expect(RESTORE_ROUTE).toContain('resolveMediaScope')
  })

  /**
   * The route answers with the reason it refused — the window closed, or the
   * bytes would breach the plan — and the client shows that sentence. A
   * generic 500 here is how "Undo failed" ends up on screen with no way to
   * find out what to do about it.
   */
  it('returns the refusal message rather than a bare status', () => {
    expect(RESTORE_ROUTE).toContain('result.message')
    expect(RESTORE_ROUTE).toContain('result.status')
  })
})

describe('both delete surfaces offer the undo (AGL-1467)', () => {
  /**
   * Single-file delete, from the grid card's overflow menu and from the
   * detail drawer — AGL-1461 routed both through this one handler precisely
   * so a change like this lands on both at once.
   */
  it('puts an Undo action on the single-delete snackbar', () => {
    expect(callbackBody('handleDelete')).toContain('action: undoAction(')
  })

  /**
   * The bulk path is the one that runs 65 times in an afternoon, which is the
   * pass that produced the two wrong deletions in the first place. Leaving it
   * out would put undo exactly where the mistake is least likely.
   */
  it('puts an Undo action on the bulk-delete snackbar', () => {
    expect(callbackBody('handleBulkDelete')).toContain('action: undoAction(')
  })

  /**
   * One control for both, for the reason AGL-1461 gave when it routed the card
   * and the drawer through a single `handleDelete`: two copies of an
   * affordance on a destructive path are two things to keep in step.
   */
  it('the shared action is the one that calls the restore', () => {
    const body = callbackBody('undoAction')
    expect(body).toContain('UNDO_LABEL')
    expect(body).toContain('restoreMedia(targets)')
  })

  /**
   * Dismissed on success ONLY. A refusal a person can act on — the plan's
   * storage limit — must not take the button with it: the server deliberately
   * keeps the tombstone through a refusal so the answer is "not yet", and
   * closing the snackbar first would make it "gone" in the UI anyway.
   */
  it('keeps the Undo button up when the restore was refused', () => {
    const body = code(callbackBody('undoAction'))
    expect(body).toMatch(/if \(ok\) closeSnackbar/)
    // The unconditional form, which is what this replaced.
    expect(body).not.toMatch(/\n\s*closeSnackbar\(snackbarId\)\n/)
  })

  /**
   * The negative that keeps this from becoming the thing AGL-1461 refused: the
   * action is attached only when the DELETE route reported a tombstone. An
   * unconditional Undo button would be recovery wording with nothing behind
   * it, which is exactly the copy that issue declined to ship.
   */
  it('only offers undo when the server says a tombstone exists', () => {
    expect(callbackBody('handleDelete')).toContain('payload?.restorable')
    expect(callbackBody('handleBulkDelete')).toContain('payload?.restorable')
  })

  /**
   * A restore puts the document back, so the window has to learn about it.
   * `dropLocal` removed it on delete (AGL-1462); refusing to re-read here
   * would leave the file restored on the server and absent from the grid,
   * which reads as an undo that did nothing.
   */
  it('brings the restored file back into the loaded window', () => {
    const body = callbackBody('restoreMedia')
    expect(body).toContain('refresh()')
  })
})
