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
 * AGL-1469 / AGL-1470, pinned where they happened.
 *
 * The behaviour lives in three executable places — `media-move.spec.ts` for
 * the budget arithmetic, `media-move-copy.spec.ts` for what the snackbar
 * says, `media-move.emulator.spec.ts` for which documents actually changed.
 * None of them can prove that THIS COMPONENT and THIS ROUTE are what call
 * them, and that is the half both issues turned on: the route had a correct
 * `moved` counter that a mid-loop throw discarded, and the picker had a
 * correct folder tree beside it that it flattened to bare names.
 *
 * Rendering the library instead is not an option, for the reason the
 * AGL-1413 / AGL-1461 / AGL-1466 specs in this folder each give: it mounts
 * the org context, four Firestore listener stacks, the DAM counters and a
 * dnd-kit surface, so a render test is a test of the mocks.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LIBRARY = readFileSync(
  join(__dirname, 'media-library.component.tsx'),
  'utf8',
)
const ROUTE = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'media', 'folders', 'route.ts'),
  'utf8',
)

/**
 * Source with comments removed. Required rather than tidy: the comments
 * below these fixes NAME the shape they replaced, so every negative
 * assertion here would otherwise pass against prose.
 *
 * A block comment is only recognised at the start of a line or inside a JSX
 * `{/* … *\/}` wrapper, NOT anywhere a `/*` happens to appear. The library
 * contains `accept="image/*"`, and a naive opener treats that MIME type as
 * the start of a comment and deletes everything up to the next `*\/` — some
 * nine hundred lines, including one of the two pickers this file is about. A
 * negative assertion over a file with a hole in it passes for the wrong
 * reason, which is the failure mode these specs exist to prevent.
 */
function code(source: string): string {
  return source
    // A JSX comment, and only a JSX comment: the body may not itself contain
    // `*/`, or `interface Props {` followed by a JSDoc field comment matches
    // as far as the next `*/ }` — 120,000 characters of it.
    .replace(/\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g, '')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const CODE = code(LIBRARY)
const ROUTE_CODE = code(ROUTE)

/** The body of a `const <name> = useCallback(` declaration. */
function callbackBody(name: string): string {
  const start = CODE.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const ends = ['\n  }, [', '\n  )']
    .map((closer) => CODE.indexOf(closer, start))
    .filter((at) => at > start)
  expect(ends.length).toBeGreaterThan(0)
  return CODE.slice(start, Math.min(...ends))
}

describe('AGL-1469 · the route bounds itself instead of being cut off', () => {
  /**
   * The ceiling was never a count. `move-assets` opens no Firestore batch at
   * all, so the 500-write limit cannot be it; `MAX_ASSETS_PER_OP` is 500 and
   * the observed failure was 19. What is left is wall-clock: a serial loop of
   * GCS copies with no bound, ended by the platform rather than by the
   * handler. This asserts the handler now owns that decision.
   */
  it('runs the move through the shared budget rather than an open loop', () => {
    const moveAction = ROUTE_CODE.slice(
      ROUTE_CODE.indexOf(`action === 'move-assets'`),
    ).slice(0, 2_000)
    expect(moveAction).toContain('moveAssetsWithinBudget')
  })

  /**
   * The budget is only meaningful inside a larger platform ceiling. Without
   * `maxDuration` this route runs at the account default, which is what a
   * 19-asset move outran — and every other heavy route in this app already
   * declares one.
   */
  it('declares a function duration, like the other long routes', () => {
    expect(ROUTE_CODE).toMatch(/export const maxDuration = \d+/)
  })

  /**
   * A partial move is a SUCCESS with a split, not a failure. Answering 500
   * is what made the client say "Move failed" over seven assets that had
   * already been relocated.
   */
  it('answers with the split rather than a status the client reads as total failure', () => {
    const moveAction = ROUTE_CODE.slice(
      ROUTE_CODE.indexOf(`action === 'move-assets'`),
    ).slice(0, 2_000)
    expect(moveAction).toContain('movedIds')
    expect(moveAction).toContain('failedIds')
    expect(moveAction).toContain('remainingIds')
  })
})

describe('AGL-1469 · the client loops, reports the split, and keeps the rest selected', () => {
  const MOVE = callbackBody('moveMedia')

  it('keeps requesting while the server hands back a remainder', () => {
    expect(MOVE).toMatch(/while|for \(/)
    expect(MOVE).toContain('remainingIds')
  })

  /**
   * The old body called `clearSelection()` unconditionally, so after a
   * partial move the twelve files that did NOT move were deselected along
   * with the seven that did — and reconstructing which was which took a
   * per-folder count afterwards. Dropping only the moved ids leaves the
   * remainder selected, which makes a retry correct by construction.
   */
  it('forgets only the ids that moved, so a retry is correct by construction', () => {
    expect(MOVE).toContain('forgetSelected')
    expect(MOVE).not.toMatch(/\bclearSelection\(\)/)
  })

  it('reports a partial move as a split rather than a failure', () => {
    expect(MOVE).toContain('partialMoveMessage')
    expect(MOVE).toContain('movedMediaMessage')
    expect(MOVE).toContain('moveFailureMessage')
  })

  /**
   * `'Move failed'` was not the handler's message. The route answers JSON, so
   * a handler-raised error arrives as `payload.error`; the literal fallback
   * only renders when the body will not parse — which is what a gateway
   * timeout returns. Its presence in the source is the tell that this path
   * still treats an unparseable response as "nothing happened".
   */
  it('no longer carries the bare fallback that hid seven completed moves', () => {
    expect(MOVE).not.toContain("'Move failed'")
  })
})

describe('AGL-1470 · every folder picker shows a path', () => {
  /**
   * Two rows reading `Covers` with no parent, no path and no ordering cue.
   * The sidebar had the hierarchy the whole time; only the pickers dropped
   * it. Both of them — the bulk MOVE TO FOLDER menu and the detail drawer's
   * Folder field — now render the same computed choices.
   */
  it('builds the choices from the shared helper', () => {
    expect(CODE).toContain('Aglyn.mediaFolderChoices')
  })

  /**
   * `folderList` is still right for the rail (which nests it itself) and for
   * the depth/sibling validation helpers. What it may never do again is reach
   * a `<MenuItem>`, which is the one place a bare name is unsafe rather than
   * merely terse.
   */
  it('leaves no picker rendering a bare folder name', () => {
    expect(CODE).not.toMatch(/folderList\.map\([\s\S]{0,200}?<MenuItem/)
    expect(CODE).not.toContain('{folder.name}\n              </MenuItem>')
  })

  it('draws both pickers from the path label', () => {
    const labels = CODE.match(/\{choice\.label\}/g) ?? []
    expect(labels.length).toBeGreaterThanOrEqual(2)
  })
})

describe('AGL-1470 · a folder create stops reading as a failure', () => {
  /**
   * The dialog waited on `batch.commit()`, which the Firestore client SDK
   * settles only when the SERVER acknowledges — while latency compensation
   * had already drawn the new folder in the rail behind it. So the folder
   * appeared, the dialog stayed, and the save read as a failure that had in
   * fact succeeded. And when validation REFUSED the name, the dialog closed
   * anyway and threw the typed name away, which is the same confusion
   * inverted.
   */
  it('closes on acceptance rather than on the server acknowledging', () => {
    const save = callbackBody('handleFolderPromptSave')
    expect(save).toContain('accepted')
  })

  it('says a folder was created', () => {
    expect(callbackBody('handleFolderCreate')).toContain('enqueueSnackbar')
  })
})
