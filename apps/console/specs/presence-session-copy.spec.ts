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

import { describe as describeSession } from '../components/presence-avatars.component'
import type { PresenceEntry } from '../hooks/use-presence'

/**
 * What a presence chip promises about collaborating (AGL-2486).
 *
 * Zach: *"Why are saves not merged? Isn't this the point of being able to
 * collaborate together and build a page alongside someone at the same
 * time"*. The old copy described the storage — one whole-document write —
 * and presented it as the user's experience, which predicted a fight that
 * does not happen in the common case: the mirror carries unsaved work per
 * NODE, so two people on different elements both keep theirs.
 *
 * Asserted here rather than off a screenshot because the failure mode is a
 * sentence, not a pixel: an over-corrected "everything merges" is as wrong
 * as the claim it replaced, and only a test that reads BOTH directions
 * catches that. Each case therefore checks something is said AND something
 * is not.
 */
const entry = (over: Partial<PresenceEntry> = {}): PresenceEntry =>
  ({
    uid: 'u1',
    sessionId: 's1',
    key: 'u1:s1',
    displayName: 'Dana Reed',
    colour: '#123456',
    isSelf: false,
    lastSeenAt: Date.now(),
    ...over,
  }) as PresenceEntry

describe('presence chip copy (AGL-2486)', () => {
  describe('a colleague', () => {
    const text = describeSession(entry())

    it('names them and says edits merge', () => {
      expect(text).toContain('Dana Reed')
      expect(text.toLowerCase()).toContain('merge live')
    })

    it('no longer claims saves are not merged', () => {
      expect(text).not.toContain('not merged')
    })

    it('still admits the two real limits', () => {
      // Same element at once is last-writer-wins…
      expect(text).toContain('the same element at the same time')
      expect(text.toLowerCase()).toContain('last change')
      // …and a save by them stops this editor rather than merging.
      expect(text.toLowerCase()).toContain('reload')
    })
  })

  describe('your own other window', () => {
    const text = describeSession(entry({ isSelf: true }))

    it('says it is you', () => {
      expect(text).toContain('This is YOU')
    })

    /**
     * The sharp one. This used to promise the opposite — "it will not warn
     * you, because both are you" — which was never true of the guard (it
     * reads the document's stamp and content and has never consulted a uid)
     * and is now false in the one way it could have been: another session's
     * write can no longer be swallowed as this session's echo.
     */
    it('promises the same protection as any other session, not the absence of it', () => {
      expect(text).toContain('separate session')
      expect(text.toLowerCase()).toContain('pauses saving in the other')
      expect(text).not.toContain('will not warn you')
      expect(text).not.toContain('saves last wins')
    })

    it('says edits merge between your own windows too', () => {
      expect(text.toLowerCase()).toContain('merge live')
      expect(text).not.toContain('Nothing merges')
    })
  })
})
