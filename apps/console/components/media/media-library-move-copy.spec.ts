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

import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  moveToOtherLibraryIntro,
  moveToOtherLibraryLabel,
  movedToOtherLibraryMessage,
  partialOtherLibraryMessage,
} from './media-library-move-copy'

describe('moving files to the other library: what the library says', () => {
  it('names the action by where the file goes', () => {
    expect(moveToOtherLibraryLabel('to-site')).toBe("Move to this site's library")
    expect(moveToOtherLibraryLabel('to-org')).toBe('Move to organization library')
  })

  it('says what moves, who can use it, and that the old address keeps working', () => {
    expect(moveToOtherLibraryIntro('to-site', 3, 5)).toBe(
      "3 files will move to this site's library. Only this site will be able to use them. 5 pages, products or settings that use them will be updated to the new address, and the old address keeps working.",
    )
    expect(moveToOtherLibraryIntro('to-org', 1, 0)).toBe(
      '1 file will move to the organization library. Every site in the workspace will be able to use them. Nothing uses them yet.',
    )
  })

  it('reports moved files and updated uses', () => {
    expect(movedToOtherLibraryMessage('to-site', 12, 31)).toBe(
      "Moved 12 files to this site's library and updated 31 uses",
    )
  })

  it('reports a partial move with what stayed, why, and that it is still selected', () => {
    expect(
      partialOtherLibraryMessage({
        direction: 'to-site',
        moved: 7,
        total: 9,
        rewrote: 12,
        notMoved: [
          { name: 'logo.png', reason: 'the workspace uses it (its logo or settings)' },
          { name: 'b.png' },
        ],
      }),
    ).toBe(
      'Moved 7 of 9 to this site\'s library and updated 12 uses — 2 could not be moved: "logo.png" (the workspace uses it (its logo or settings)), "b.png", and are still selected',
    )
  })
})

describe('moving files to the other library: wiring', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

  it('offers the move on both tabs of a site’s Media page, naming the site and its workspace', () => {
    const page = read('../../app/(app)/[orgSlug]/hosts/[host]/media/page.tsx')
    expect(page).toContain('libraryMove={hostOrgId ? { orgId: hostOrgId, hostId } : undefined}')
    expect(page).toContain('libraryMove={{ orgId: hostOrgId, hostId }}')
  })

  it('puts the action in the drawer and on a selection, and keeps unmoved files selected', () => {
    const library = read('./media-library.component.tsx')
    expect(library).toContain('setLibraryMoveIds([editor.id])')
    expect(library).toContain('setLibraryMoveIds([...selected])')
    expect(library).toContain('forgetSelected(movedIds)')
  })

  it('previews before it moves, and asks again for what the server did not reach', () => {
    const dialog = read('./media-library-move-dialog.component.tsx')
    expect(dialog).toContain('preview: true')
    expect(dialog).toContain("payload.remainingIds ?? []")
  })
})
