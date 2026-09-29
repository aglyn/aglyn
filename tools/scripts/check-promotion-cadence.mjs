#!/usr/bin/env node
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

// Fails when `production` has already taken its promotions for the day
// (AGL-3413). Run by promotion-cadence.yml on every PR into `production`;
// `release:prepare --write` applies the same cap before a version is cut.
//
//   node tools/scripts/check-promotion-cadence.mjs [--ref origin/production] [--hotfix]
//
// It does not fetch. The caller decides how fresh the ref is.

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  describeCadence,
  evaluateCadence,
  readProductionMerges,
} from './lib/promotion-cadence.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

const argv = process.argv.slice(2)
const refIndex = argv.indexOf('--ref')
const ref = refIndex >= 0 ? argv[refIndex + 1] : 'origin/production'
const hotfix = argv.includes('--hotfix')

const verdict = evaluateCadence({
  merges: readProductionMerges(git, ref),
  hotfix,
})
console.log(describeCadence(verdict).join('\n'))
process.exitCode = verdict.allowed ? 0 : 1
