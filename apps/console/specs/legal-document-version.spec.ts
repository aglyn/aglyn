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
 * AGL-1497 — a version has to mean ONE text.
 *
 * The whole clickwrap record rests on `v1` naming a fixed document set. If the
 * archived text can be edited while the version stays put, every record that
 * says "accepted v1" becomes decorative: two users could have agreed to
 * materially different terms and the evidence would be identical.
 *
 * Nobody should have to remember to bump the version, so this makes it
 * mechanical. Editing a snapshot without changing the hash fails here; the fix
 * is to add `legal/v2/` and bump `LEGAL_DOCUMENT_VERSION`, which is exactly
 * the ceremony republishing the Terms is supposed to involve.
 *
 * This guards the text WE archive. It cannot see the live page — that drift is
 * caught by re-snapshotting at publish time, which is when the version should
 * be bumped anyway.
 */

import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  LEGAL_DOCUMENT_VERSION,
  LEGAL_DOCUMENTS,
} from '../constants/legal-documents'
import { LEGAL_URLS } from '../constants/shared'

const snapshotDir = join(__dirname, '..', 'constants', 'legal', LEGAL_DOCUMENT_VERSION)

const snapshot = (key: string) =>
  readFileSync(join(snapshotDir, `${key}.txt`), 'utf-8')

describe('legal document version', () => {
  it.each(LEGAL_DOCUMENTS.map((doc) => [doc.key, doc] as const))(
    'pins %s to the exact text that version was published with',
    (_key, doc) => {
      const text = snapshot(doc.key)
      expect(createHash('sha256').update(text, 'utf-8').digest('hex')).toBe(
        doc.sha256,
      )
      expect(Buffer.byteLength(text, 'utf-8')).toBe(doc.bytes)
    },
  )

  it('archives every document the consent control links to', () => {
    // A link with no snapshot behind it is the original problem wearing a
    // manifest: the record would name a document it cannot reproduce.
    const archived = readdirSync(snapshotDir)
      .filter((name) => name.endsWith('.txt'))
      .map((name) => name.replace(/\.txt$/, ''))
      .sort()
    expect(archived).toEqual(LEGAL_DOCUMENTS.map((doc) => doc.key).sort())
    expect(archived).toEqual(
      Object.keys(LEGAL_URLS)
        .map((key) => key.toLowerCase())
        .sort(),
    )
  })

  it('keeps the manifest pointing at the canonical published URLs', () => {
    expect(LEGAL_DOCUMENTS.map((doc) => doc.url).sort()).toEqual(
      [LEGAL_URLS.PRIVACY, LEGAL_URLS.TERMS].sort(),
    )
  })

  it('archives a document that actually reads like the document', () => {
    // Cheap sanity that the snapshot is the legal text and not, say, a 404
    // page or the site chrome that surrounds it.
    expect(snapshot('terms')).toContain('These Terms of Service')
    expect(snapshot('terms')).toContain('Aglyn LLC')
    expect(snapshot('privacy')).toContain('Last updated:')
  })
})
