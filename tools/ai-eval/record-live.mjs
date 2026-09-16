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

// Records new answers to the AI eval harness's golden briefs from the live
// provider (AGL-2937), and writes them under tools/ai-eval/recordings for the
// offline harness to score.
//
//   AI_EVAL_LIVE=1 npm run eval:ai-live
//
// It spends real money on the provider, so without AI_EVAL_LIVE=1 it refuses
// before anything runs. The recording itself is the plugin spec
// `ai-eval.live.spec.ts`, which reuses the production step runners.

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

if (process.env.AI_EVAL_LIVE !== '1') {
  console.error(
    'Refused: a live eval run asks the AI provider for real answers and spends real money. ' +
      'Set AI_EVAL_LIVE=1 to run it, from a machine that holds a provider key. It never runs in CI.',
  )
  process.exit(1)
}

const result = spawnSync(
  'npx',
  [
    'jest',
    '-c',
    'libs/plugins/ai/jest.config.ts',
    'libs/plugins/ai/src/lib/runtime/ai-eval.live.spec.ts',
    '--runInBand',
  ],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
)
process.exit(result.status ?? 1)
