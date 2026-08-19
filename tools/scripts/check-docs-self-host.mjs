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

// Fails when apps/docs compiles in an Aglyn-operated endpoint or analytics id,
// which would make a self-hosted docs build report to us (AGL-2124).
//
//   node tools/scripts/check-docs-self-host.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  evaluateDocsSelfHost,
  formatDocsSelfHostFailure,
} from './lib/docs-self-host.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The files that reach an operator's BUILD — config and browser sources. Docs
 * CONTENT (`docs/**`, `blog/**`) is prose about Aglyn's hosted product and is
 * meant to name our URLs; scanning it would make this check noise, and a noisy
 * check gets suppressed.
 */
const out = execFileSync(
  'git',
  ['ls-files', 'apps/docs/docusaurus.config.ts', 'apps/docs/src/**'],
  { cwd: repoRoot, encoding: 'utf8' },
)

const files = out
  .split('\n')
  .filter((path) => /\.(ts|tsx|js|jsx|mjs)$/.test(path))
  .map((path) => ({ path, source: readFileSync(join(repoRoot, path), 'utf8') }))

const result = evaluateDocsSelfHost(files)

if (result.ok) {
  console.log(
    `apps/docs carries no Aglyn-operated endpoint or analytics id (${result.checked} file(s) scanned).`,
  )
  process.exit(0)
}

console.error(formatDocsSelfHostFailure(result))
process.exit(1)
