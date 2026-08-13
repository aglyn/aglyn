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

import {
  movedMediaMessage,
  moveFailureMessage,
  partialMoveMessage,
} from './media-move-copy'

describe('movedMediaMessage', () => {
  it('names the destination by its full path, not its bare name', () => {
    expect(movedMediaMessage(11, 'Blog / Covers')).toBe(
      'Moved 11 files to "Blog / Covers"',
    )
  })

  it('singularises', () => {
    expect(movedMediaMessage(1, 'Blog / Covers')).toBe(
      'Moved 1 file to "Blog / Covers"',
    )
  })

  it('says where a file goes when it goes nowhere in particular', () => {
    expect(movedMediaMessage(3, null)).toBe('Moved 3 files out of their folders')
  })
})

/**
 * The message AGL-1469 is about. A bulk move that half-succeeded reported a
 * red "Move failed" — which inverts the safe response, because "failed"
 * invites a retry and a retry runs against a selection seven of whose files
 * have already been rewritten to a new prefix.
 */
describe('partialMoveMessage', () => {
  it('reports the true split in the vocabulary AGL-1461 established', () => {
    expect(
      partialMoveMessage({
        movedCount: 7,
        totalCount: 19,
        destination: 'Blog / Covers',
        failedNames: [],
      }),
    ).toBe(
      'Moved 7 of 19 to "Blog / Covers" — 12 could not be moved, and are ' +
        'still selected',
    )
  })

  it('names the files that did not move while a snackbar can still hold them', () => {
    expect(
      partialMoveMessage({
        movedCount: 1,
        totalCount: 3,
        destination: 'Press / Covers',
        failedNames: ['a.png', 'b.png'],
      }),
    ).toBe(
      'Moved 1 of 3 to "Press / Covers" — 2 could not be moved: "a.png" and ' +
        '"b.png", and are still selected',
    )
  })

  it('counts what it elides rather than trailing off', () => {
    const message = partialMoveMessage({
      movedCount: 7,
      totalCount: 19,
      destination: 'Blog / Covers',
      failedNames: Array.from({ length: 12 }, (_, i) => `f${i}.png`),
    })
    expect(message).toContain('12 could not be moved')
    expect(message).toContain('and 9 more')
  })
})

describe('moveFailureMessage', () => {
  /**
   * Nothing moved is the ONE case where "failed" is honest. It still has to
   * say where the files are now, because the reason the old message was
   * dangerous is that it left that unanswered.
   */
  it('says nothing moved and where the files still are', () => {
    expect(moveFailureMessage(19, [])).toBe(
      'Could not move 19 files — they are still in their original folder',
    )
  })

  it('names one file', () => {
    expect(moveFailureMessage(1, ['hero.png'])).toBe(
      'Could not move "hero.png" — it is still in its original folder',
    )
  })
})
