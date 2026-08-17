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
 * AGL-1678 — a publisher-agreement version has to mean ONE text.
 *
 * The acceptance record pins `PUBLISHER_AGREEMENT_SHA256`/`_BYTES` onto every
 * acceptance, and those constants pin the archived snapshot here. If the
 * snapshot could be edited while the version and hash stay put, every record
 * that says "accepted 2026-08-14.1" becomes decorative: two publishers could
 * have agreed to materially different terms and the evidence would be
 * identical. Same mechanics as the signup clickwrap's
 * `specs/legal-document-version.spec.ts` (AGL-1497), kept parallel rather
 * than merged because the two acceptance scopes are deliberately different.
 *
 * This guards the text WE archive. It cannot see the live page — that drift
 * is caught by re-snapshotting at publish time, which is when the version
 * should be bumped anyway (publication first, capture second, never
 * hand-written).
 */

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PUBLISHER_AGREEMENT_BYTES,
  PUBLISHER_AGREEMENT_SHA256,
  PUBLISHER_AGREEMENT_TITLE,
  PUBLISHER_AGREEMENT_VERSION,
} from './publisher-agreement'

const snapshotPath = join(
  __dirname,
  'legal',
  'publisher-agreement',
  PUBLISHER_AGREEMENT_VERSION,
  'marketplace-publisher-agreement.txt',
)

const snapshot = () => readFileSync(snapshotPath, 'utf-8')

describe('publisher agreement version (AGL-1678)', () => {
  it('pins the version to the exact text it was published with', () => {
    // Reading the snapshot from a directory NAMED by the version is itself an
    // assertion: bumping the version without capturing a new snapshot fails
    // here with ENOENT, which is the ceremony working, not an inconvenience.
    const text = snapshot()
    expect(createHash('sha256').update(text, 'utf-8').digest('hex')).toBe(
      PUBLISHER_AGREEMENT_SHA256,
    )
    expect(Buffer.byteLength(text, 'utf-8')).toBe(PUBLISHER_AGREEMENT_BYTES)
  })

  it('archives the version the constant claims, in the text itself', () => {
    // The document carries its own `Agreement version:` header. The directory
    // name, the constant and the captured text must all agree — otherwise a
    // snapshot could be filed under a version the page never displayed.
    expect(snapshot()).toContain(
      `Agreement version: ${PUBLISHER_AGREEMENT_VERSION}`,
    )
  })

  it('archives a document that actually reads like the agreement', () => {
    // Cheap sanity that the snapshot is the legal text and not, say, a 404
    // page or the site chrome that surrounds it.
    const text = snapshot()
    expect(text).toContain(`This ${PUBLISHER_AGREEMENT_TITLE}`)
    expect(text).toContain('Aglyn LLC')
    expect(text).toContain('Last updated:')
    // And that it is the PUBLISHED text, not the July draft this version
    // replaced: the draft opened with an attorney-review banner and said the
    // publisher was the seller of record; the published text says Aglyn is
    // the merchant of record.
    expect(text).not.toContain('ATTORNEY REVIEW REQUIRED')
    expect(text).toContain('merchant of record')
  })
})
