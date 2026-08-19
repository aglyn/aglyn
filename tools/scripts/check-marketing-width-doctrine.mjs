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

// Fails when a marketing authoring doc prescribes a pixel content width
// instead of the stock `maxWidth: "xl"` invariant (AGL-1298).
//
//   node tools/scripts/check-marketing-width-doctrine.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DOCTRINE_DOCS,
  evaluateMarketingWidthDoctrine,
  formatMarketingWidthDoctrineFailure,
} from './lib/marketing-width-doctrine.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Enumerated, not walked: these two docs are the ones an agent reads before
// touching a marketing page, and the detector's `REQUIRED_ASSERTIONS` names
// the skeleton explicitly — a filesystem walk that silently missed it would
// report green over a doc that had been deleted.
const files = DOCTRINE_DOCS.map((path) => ({
  path,
  source: readFileSync(join(repoRoot, path), 'utf8'),
}))

const result = evaluateMarketingWidthDoctrine(files)

if (result.ok) {
  console.log(
    `Marketing width doctrine holds: stock maxWidth "xl" -> 1392 @1440 / ` +
      `1488 @1920 (the measured frames), no pixel column asserted ` +
      `(${result.checked} doc(s) scanned).`,
  )
  process.exit(0)
}

console.error(formatMarketingWidthDoctrineFailure(result))
process.exit(1)
