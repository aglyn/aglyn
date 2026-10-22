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
 * AGL-1902 — parsing the handoff return fragment.
 *
 * Small, and worth pinning because the two halves are different KINDS of
 * secret: a pointer that is useless alone and a secret that is useless alone.
 * A parse that swapped or truncated them would turn every redemption into a
 * `bad-secret` refusal, which reads as "the feature does not work" rather than
 * as a bug in eight lines of string handling.
 */

import { parseHandoffFragment } from '../utils/handoff-fragment'

describe('parseHandoffFragment', () => {
  it('splits on the FIRST dot, so a dotted secret survives', () => {
    expect(parseHandoffFragment('#abc-123.se.cr.et')).toEqual({
      requestId: 'abc-123',
      secret: 'se.cr.et',
    })
  })

  it('tolerates a missing leading hash', () => {
    expect(parseHandoffFragment('rid.secret')).toEqual({
      requestId: 'rid',
      secret: 'secret',
    })
  })

  it('decodes percent-encoding on both halves', () => {
    expect(parseHandoffFragment('#a%2Db.s%2Bt')).toEqual({
      requestId: 'a-b',
      secret: 's+t',
    })
  })

  it('returns null for every shape that is not a handoff', () => {
    expect(parseHandoffFragment('')).toBeNull()
    expect(parseHandoffFragment('#')).toBeNull()
    expect(parseHandoffFragment(null)).toBeNull()
    expect(parseHandoffFragment(undefined)).toBeNull()
    // No dot: a pointer with no secret is not redeemable and must not be
    // presented as one — the endpoint would answer `bad-secret` and the
    // landing page would offer a retry for a URL that can never work.
    expect(parseHandoffFragment('#rid-only')).toBeNull()
    // Leading dot: no request id.
    expect(parseHandoffFragment('#.secret')).toBeNull()
    // Trailing dot: no secret.
    expect(parseHandoffFragment('#rid.')).toBeNull()
  })

  it('returns null rather than throwing on malformed encoding', () => {
    expect(parseHandoffFragment('#rid.%E0%A4%A')).toBeNull()
  })
})
