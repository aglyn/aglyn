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

// Does the deployed log-drain receiver run the gate in the repo? (AGL-1921)
//
//   node tools/scripts/check-log-drain-drift.mjs [--baseline=<ref>]
//
// Exit codes, on the convention the other drift checkers share:
//   0  the receiver answers the stamp of <ref> (default HEAD)
//   1  it answers another stamp, or none
//   2  it could not be reached, or <ref> could not be read
import { execFileSync } from 'node:child_process'
import { logDrainSourceStamp } from './lib/log-drain-source-stamp.mjs'

const RECEIVER_URL = 'https://log-drain-receiver-543499566626.us-central1.run.app/'
const DEPLOY = 'cloud/log-drain/deploy.sh'

const baselineArg = process.argv.slice(2).find((arg) => arg.startsWith('--baseline='))
const baseline = baselineArg ? baselineArg.slice('--baseline='.length) : 'HEAD'

let expected
try {
  expected = logDrainSourceStamp((path) =>
    execFileSync('git', ['show', `${baseline}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
} catch (error) {
  console.error(`CANNOT CHECK: could not read the drain sources at ${baseline}: ${error.message}`)
  process.exit(2)
}

let live
try {
  const response = await fetch(RECEIVER_URL, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`status ${response.status}`)
  live = (await response.json()).sourceStamp ?? null
} catch (error) {
  console.error(`CANNOT CHECK: the receiver did not answer: ${error.message}`)
  process.exit(2)
}

if (live === expected) {
  console.log(`log-drain-receiver is deployed at ${baseline} (${live}).`)
  process.exit(0)
}
console.error(
  `log-drain-receiver answers ${live ?? 'no stamp'}, ${baseline} is ${expected}. Run ${DEPLOY} from that commit.`,
)
process.exit(1)
