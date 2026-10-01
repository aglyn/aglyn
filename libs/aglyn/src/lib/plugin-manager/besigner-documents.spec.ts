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
  besignerDocumentForSegment,
  besignerDocuments,
  besignerDocumentTitle,
  besignerPublishRefusal,
} from './besigner-documents'

describe('the declared besigner documents', () => {
  it('resolves a declared segment and nothing else', () => {
    for (const declared of besignerDocuments()) {
      expect(besignerDocumentForSegment(declared.segment)).toBe(declared)
    }
    // The console's own editors are routed by name; a segment nobody
    // declared is not a plugin document, whatever it looks like.
    expect(besignerDocumentForSegment('screens')).toBeNull()
    expect(besignerDocumentForSegment('')).toBeNull()
    expect(besignerDocumentForSegment(undefined)).toBeNull()
  })

  it('gives every declaration a publish route under /api', () => {
    for (const declared of besignerDocuments()) {
      expect(declared.publish.path).toMatch(/^\/api\//)
      expect(declared.publish.idField).toMatch(/^[a-z][A-Za-z0-9]*$/)
    }
  })

  it('raises only the first letter of a noun', () => {
    expect(besignerDocumentTitle('form')).toBe('Form')
    expect(besignerDocumentTitle('bottle label')).toBe('Bottle label')
  })
})

describe('what a refused publish tells the author', () => {
  it('shows one violation in full', () => {
    expect(
      besignerPublishRefusal(
        { error: 'x', violations: [{ message: 'Name the email field.' }] },
        'form',
      ),
    ).toBe('Name the email field.')
  })

  it('shows the first of several with a count of the rest', () => {
    expect(
      besignerPublishRefusal(
        {
          violations: [
            { message: 'Name the email field.' },
            { message: 'Keep the consent box.' },
            { message: 'Keep the form id.' },
          ],
        },
        'form',
      ),
    ).toBe(
      'Name the email field. There are 2 other problems to fix before this ' +
        'form can be published.',
    )
    expect(
      besignerPublishRefusal(
        { violations: [{ message: 'A.' }, { message: 'B.' }] },
        'label',
      ),
    ).toBe('A. There is 1 other problem to fix before this label can be published.')
  })

  it('falls back to the route error, then to a plain failure', () => {
    expect(besignerPublishRefusal({ error: 'Unknown version' }, 'form')).toBe(
      'Unknown version',
    )
    expect(besignerPublishRefusal({}, 'form')).toBe(
      'The form could not be published.',
    )
    expect(besignerPublishRefusal(null, 'form')).toBe(
      'The form could not be published.',
    )
    // A malformed violation is not a sentence to show.
    expect(
      besignerPublishRefusal({ error: 'Refused', violations: [{ code: 1 }] }, 'form'),
    ).toBe('Refused')
  })
})
