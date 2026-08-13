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
 * AGL-1461/AGL-1467: what the DAM tells an author AFTER a delete.
 *
 * The snackbar used to read "File deleted" whatever had gone. On 2026-08-13 a
 * deletion pass over 65 files removed two that should have been kept, and
 * nothing on screen ever said which files had left — the only reason they came
 * back was that somebody remembered, inside the soft-delete window, roughly
 * what they had clicked. A confirmation that does not identify its subject is
 * not a confirmation; it is an acknowledgement that something happened.
 *
 * ## The rule that changed, and the rule that did not
 *
 * AGL-1461 asserted that no word offering the file back could reach the
 * screen, because none was backed by anything: the delete hard-deleted the
 * Firestore document, so the bytes GCS was holding for seven days had no
 * address. AGL-1467 built the tombstone that gives them one, so "undo" is now
 * a true thing to say — and the spec must let it be said, or it pins the
 * product to the older, smaller truth.
 *
 * What survives unchanged is the REASON that rule existed: copy may only offer
 * what an author can actually reach from where they are standing. So the
 * assertions invert rather than relax.
 *
 *  - Recovery wording is allowed exactly where the affordance is — the
 *    snackbar's Undo action, and the confirmation that announces it.
 *  - **No message may name a WINDOW.** The tombstone lives seven days, and the
 *    snackbar lives seconds. "Recoverable for 7 days" would be true of the
 *    tombstone and false of the only control on screen — the same
 *    true-of-the-bucket, false-of-the-console mistake AGL-1461 refused, one
 *    layer along. If a durable recently-deleted surface is ever built, THAT is
 *    what earns the duration.
 */

import {
  deleteConfirmationLead,
  deleteFailureMessage,
  deletedMediaMessage,
  restoreFailureMessage,
  restoredMediaMessage,
  SCAN_PENDING_NOTE,
  UNDO_LABEL,
} from './media-delete-copy'

/**
 * Durations no message may claim. The affordance is a snackbar; it does not
 * last a week, and copy that says otherwise is describing the tombstone rather
 * than the button.
 */
const WINDOW_CLAIMS = ['7 day', 'seven day', 'week', 'day', 'hour', 'minute']

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
   * The load-bearing negative, in its AGL-1467 form. Undo is real now, so the
   * word is allowed — the DURATION is not. See the header.
   */
  it('claims no recovery window the snackbar cannot deliver', () => {
    const messages = [
      deletedMediaMessage(['a.png']),
      deletedMediaMessage(['a.png', 'b.png', 'c.png', 'd.png']),
      deleteFailureMessage(['a.png']),
      restoredMediaMessage(['a.png']),
      restoreFailureMessage('a.png'),
      deleteConfirmationLead('a.png'),
      UNDO_LABEL,
    ]
    for (const message of messages) {
      for (const claim of WINDOW_CLAIMS) {
        expect({ message, claim, claims: message.toLowerCase().includes(claim) })
          .toEqual({ message, claim, claims: false })
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

describe('the undo affordance (AGL-1467)', () => {
  /**
   * A label short enough for a snackbar action and unambiguous about what it
   * reverses. The word is the affordance's whole contract with the reader.
   */
  it('offers a one-word action', () => {
    expect(UNDO_LABEL.toLowerCase()).toContain('undo')
    expect(UNDO_LABEL.length).toBeLessThanOrEqual(12)
  })

  it('names what came back', () => {
    expect(restoredMediaMessage(['hero-banner.png'])).toBe(
      'Restored "hero-banner.png"',
    )
    const many = restoredMediaMessage(['a.png', 'b.png'])
    expect(many).toContain('2 files')
    expect(many).toContain('"a.png"')
  })

  /**
   * A restore can be refused for real reasons the server knows and the client
   * does not — the window closed, or putting the bytes back would breach the
   * plan's storage limit. The fallback must still name the file, and the
   * server's own sentence must be able to travel through it: "Undo failed" is
   * the AGL-1461 defect wearing a different verb.
   */
  it('carries the server\'s reason rather than swallowing it', () => {
    expect(restoreFailureMessage('hero-banner.png')).toContain(
      '"hero-banner.png"',
    )
    expect(
      restoreFailureMessage('hero-banner.png', 'Storage limit reached.'),
    ).toContain('Storage limit reached.')
  })
})

describe('the delete confirmation lead (AGL-1461/AGL-1467)', () => {
  it('names the file', () => {
    const lead = deleteConfirmationLead('hero-banner.png')
    expect(lead).toContain('"hero-banner.png"')
  })

  /**
   * It used to end "This cannot be undone from the console", which was true
   * and is not any more. A confirmation that overstates the finality of the
   * act is the mirror of one that understates it — both leave the author
   * deciding against a false model.
   */
  it('no longer claims the delete cannot be undone', () => {
    const lead = deleteConfirmationLead('hero-banner.png').toLowerCase()
    expect(lead).not.toContain('cannot be undone')
    expect(lead).toContain('undo')
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
