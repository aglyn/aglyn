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

import { publishFailureMessage } from './publish-failure-message'

describe('publishFailureMessage (AGL-1334)', () => {
  it('always leads with the consequence, never with the stack', () => {
    for (const error of [
      new Error('permission-denied'),
      new Error('Function updateDoc() called with invalid data.'),
      new Error('Failed to get document because the client is offline.'),
      new Error('something nobody has seen before'),
      'a bare string',
      undefined,
    ]) {
      expect(publishFailureMessage(error)).toMatch(/^Not published —/)
    }
  })

  it('names a next step for the Firestore rejection this issue is about', () => {
    const message = publishFailureMessage(
      new Error(
        'Function updateDoc() called with invalid data. Unsupported field ' +
          'value: undefined (found in field nodes.`-axPgIP0OT`.props.' +
          'startIconPath in document hosts/DX/components/TG)',
      ),
    )
    expect(message).toContain('Reload the editor and publish again')
    // The raw text is evidence for a bug report — kept, but last.
    expect(message).toContain('startIconPath')
    expect(message.indexOf('Not published')).toBeLessThan(
      message.indexOf('startIconPath'),
    )
  })

  it('tells an author without rights who can publish', () => {
    expect(publishFailureMessage(new Error('Missing or insufficient permissions.')))
      .toContain('owner or admin')
  })

  it('reads as a connection problem when it is one', () => {
    expect(
      publishFailureMessage(new Error('The service is currently unavailable.')),
    ).toContain('Check your connection')
  })

  it('says something actionable even with nothing to go on', () => {
    expect(publishFailureMessage(undefined)).toContain('reload the editor')
  })
})
