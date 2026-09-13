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

// The clickwrap version a seeded account is recorded as having accepted.
//
// A seed writes `users/{uid}/legalAcceptances/<version>` so the console opens
// without the re-acceptance banner. That only holds while the seeded version is
// the one `LEGAL_DOCUMENT_VERSION` names: a hand-typed copy stays behind at the
// next bump, and from then on every e2e page, and every screenshot a harness
// stages, carries the banner. So the version is read from the manifest itself.
//
// The manifest is TypeScript, so it is parsed rather than imported, the same
// trade `check-legal-snapshots.mjs` makes. A manifest this cannot read throws:
// a seed that guessed the version would reintroduce the banner silently.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MANIFEST_PATH = fileURLToPath(
  new URL('../../../apps/console/constants/legal-documents.ts', import.meta.url),
)

/**
 * `LEGAL_DOCUMENT_VERSION` as declared in the console's legal manifest.
 *
 * @param source - the manifest's text; read from the repo when omitted.
 * @returns the version id, e.g. `v2`.
 */
export function readLegalDocumentVersion(
  source = readFileSync(MANIFEST_PATH, 'utf8'),
) {
  const version = /export const LEGAL_DOCUMENT_VERSION = '([^']+)'/.exec(
    source,
  )?.[1]
  if (!version || !/^v\d+$/.test(version)) {
    throw new Error(
      `LEGAL_DOCUMENT_VERSION could not be read from ${MANIFEST_PATH}`,
    )
  }
  return version
}
