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
 * AGL-1461: what the DAM tells an author AFTER a delete.
 *
 * The snackbar used to read "File deleted" whatever had gone. On 2026-08-13 a
 * deletion pass over 65 files removed two that should have been kept, and
 * nothing on screen ever said which files had left — the only reason they came
 * back was that somebody remembered, inside the soft-delete window, roughly
 * what they had clicked. A confirmation that does not identify its subject is
 * not a confirmation; it is an acknowledgement that something happened.
 *
 * The second rule here is about what the sentence must NOT say. GCS retains
 * the objects for seven days, but this delete path hard-deletes the Firestore
 * document (`mediaRef.delete()` in `app/api/media/upload/route.ts`) and there
 * is no restore in the product. So any word that offers recovery — "undo",
 * "restore", "recoverable", "trash" — is a promise the console cannot keep,
 * and is asserted unreachable rather than merely absent today.
 */

import {
  deleteConfirmationLead,
  deleteFailureMessage,
  deletedMediaMessage,
  SCAN_PENDING_NOTE,
} from './media-delete-copy'

/**
 * Words that offer the file back. None of them may appear in a message shown
 * after the delete has already happened, because none of them is backed by an
 * affordance the author can click.
 */
const RECOVERY_WORDS = [
  'undo',
  'restore',
  'recover',
  'trash',
  'bin',
  '7 days',
  'seven days',
]

describe('the deleted-media snackbar (AGL-1461)', () => {
  it('names the file when one file went', () => {
    expect(deletedMediaMessage(['hero-banner.png'])).toBe(
      'Deleted "hero-banner.png"',
    )
  })

  it('counts AND names when several went', () => {
    const message = deletedMediaMessage(['a.png', 'b.png'])
    expect(message).toContain('2 files')
    expect(message).toContain('"a.png"')
    expect(message).toContain('"b.png"')
  })

  /**
   * A snackbar is one line. Past a handful of names the count is the useful
   * fact and the rest have to be elided — but the elision has to be COUNTED,
   * not silent, or the sentence understates what was removed.
   */
  it('elides past a handful, and says how many it elided', () => {
    const names = Array.from({ length: 12 }, (_index, i) => `file-${i}.png`)
    const message = deletedMediaMessage(names)
    expect(message).toContain('12 files')
    expect(message).toContain('"file-0.png"')
    expect(message).toContain('9 more')
    expect(message).not.toContain('file-11.png')
  })

  it('never claims a count it cannot name', () => {
    expect(deletedMediaMessage([])).not.toMatch(/deleted \d/i)
  })

  /**
   * The load-bearing negative. See the header: there is no restore path in
   * the product, so the copy may not gesture at one.
   */
  it('offers no recovery it cannot deliver', () => {
    const messages = [
      deletedMediaMessage(['a.png']),
      deletedMediaMessage(['a.png', 'b.png', 'c.png', 'd.png']),
      deleteFailureMessage(['a.png']),
    ]
    for (const message of messages) {
      for (const word of RECOVERY_WORDS) {
        expect({ message, word, offers: message.toLowerCase().includes(word) })
          .toEqual({ message, word, offers: false })
      }
    }
  })

  /**
   * The bulk loop deletes one file per request and a failure halfway through
   * leaves the earlier ones gone. Reporting only "an error has occurred" then
   * hides the deletions that DID happen — the same defect as the unnamed
   * success message, in the case where naming matters most.
   */
  it('names the files a partial failure left behind', () => {
    expect(deleteFailureMessage(['c.png'])).toContain('"c.png"')
    expect(deleteFailureMessage(['c.png', 'd.png'])).toContain('2 files')
  })
})

describe('the delete confirmation lead (AGL-1461)', () => {
  it('names the file and states that the console cannot take it back', () => {
    const lead = deleteConfirmationLead('hero-banner.png')
    expect(lead).toContain('"hero-banner.png"')
    expect(lead.toLowerCase()).toContain('cannot be undone')
  })

  /**
   * The dialog now opens before the usage scan resolves (AGL-1461), so the
   * scan has a visible pending state. It has to read as work in progress —
   * a blank where the warning will go is indistinguishable from "we checked
   * and there is nothing to say", which is the AGL-1413 failure exactly.
   */
  it('says the usage check is still running rather than staying blank', () => {
    expect(SCAN_PENDING_NOTE.trim().length).toBeGreaterThan(0)
    expect(SCAN_PENDING_NOTE.toLowerCase()).toContain('checking')
  })
})
