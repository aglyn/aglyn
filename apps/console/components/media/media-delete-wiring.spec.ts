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
 * AGL-1461: the two facts about the delete path that live in the 3,000-line
 * library component and cannot be reached by rendering it.
 *
 * `MediaLibraryComponent` mounts a Firestore listener stack, the org context,
 * the DAM counters and a dnd-kit surface; a render test for either of these
 * would be a test of the mocks. Both are properties of the DECLARATION, which
 * is where the AGL-1380/AGL-1413 specs in this folder also assert — and where
 * a future edit that walks one of them back is visible.
 *
 * 1. **The drawer can delete.** The detail drawer is where an author confirms
 *    *this is the right file*, including via FIND WHERE THIS IS USED. Before
 *    this issue the only delete control was the grid card's overflow menu, so
 *    the check and the action happened in different places — which is how, on
 *    2026-08-13, two files that should have been kept were deleted.
 *
 * 2. **The confirm does not await the scan.** `scanReferences` walks up to
 *    1,500 documents; awaiting it before `confirm()` is what made the dialog
 *    look broken. The promise is handed to the dialog instead.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { code } from '../../specs/source-text'

/**
 * Comments removed, through the shared bounded stripper (AGL-1479).
 *
 * This file used to assert over the raw text, which is the other half of the
 * same illness its siblings had: the drawer's delete control carries a comment
 * that NAMES what it replaced, so "the drawer offers a delete control" could be
 * satisfied by the sentence explaining that it now does.
 */
const SOURCE = code(
  readFileSync(join(__dirname, 'media-library.component.tsx'), 'utf8'),
  'media-library.component.tsx',
)

/** The body of `handleDelete`, from its declaration to the closing dep array. */
function handleDeleteBody(): string {
  const start = SOURCE.indexOf('const handleDelete = useCallback(')
  expect(start).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('\n  )', start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

/** Everything inside the detail `<Drawer …>`. */
function drawerMarkup(): string {
  const start = SOURCE.indexOf('<Drawer')
  expect(start).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('</Drawer>', start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

describe('delete from the detail drawer (AGL-1461)', () => {
  it('offers a delete control inside the drawer', () => {
    expect(drawerMarkup()).toContain('Delete file')
  })

  /**
   * Wired to the SAME handler as the grid card. A second delete
   * implementation in the drawer is how the reference scan, the activity log
   * entry and the confirmation copy drift apart between the two surfaces.
   */
  it('routes it through the shared handleDelete, not a second path', () => {
    expect(drawerMarkup()).toContain('handleDelete(editor.media)')
  })
})

describe('the confirm dialog does not wait on the scan (AGL-1461)', () => {
  it('never awaits scanReferences inside handleDelete', () => {
    expect(handleDeleteBody()).not.toContain('await scanReferences')
  })

  /**
   * The positive half: the scan still has to HAPPEN and still has to reach
   * the dialog. Dropping the call entirely would satisfy the assertion above
   * and would quietly undo AGL-1413.
   */
  it('still starts the scan and hands it to the dialog', () => {
    const body = handleDeleteBody()
    expect(body).toContain('scanReferences(media.$id)')
    expect(body).toContain('MediaDeleteConfirmDescription')
  })
})
