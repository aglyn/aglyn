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
 * Predeploy hook: record which commit this functions deploy ships (AGL-3968).
 *
 * Writes `AGLYN_SOURCE_SHA=<HEAD sha>` into `cloud/functions/.env`. Predeploy
 * hooks run before firebase-tools reads the dotenv, and firebase-functions
 * copies every dotenv variable onto every function it deploys, so after a full
 * deploy each function carries the sha of the source it was built from.
 * `npm run check:functions-drift` reads it back from the Cloud Functions API
 * and compares that commit's package tree with the promoted one, which is the
 * only way to tell which code is live: the API never returns the source, and a
 * deploy time says nothing about which checkout it was run from.
 *
 * A checkout with uncommitted package changes is stamped `<sha>-dirty`, which
 * the check reports as DIRTY, because no commit describes what was packed.
 * Without git at all, any earlier stamp is removed, so the deploy reads as
 * UNSTAMPED rather than carrying an older sha forward as a false match.
 *
 * A symlinked `.env` (pointing at the main checkout's) is replaced by a copy
 * first, so one worktree's stamp never lands in another checkout's file.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DIRTY_STAMP_SUFFIX,
  FUNCTIONS_SOURCE_PATHSPECS,
  SOURCE_STAMP_ENV,
  withSourceStamp,
} from '../../../tools/scripts/lib/functions-drift.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dotenvPath = join(root, '.env')

// trimEnd, not trim: a porcelain status line starts with its own column.
function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd()
}

let stamp = null
try {
  const top = git(['rev-parse', '--show-toplevel'], root)
  const sha = git(['rev-parse', '--verify', 'HEAD^{commit}'], top)
  const dirty = git(
    ['status', '--porcelain', '--untracked-files=all', '--', ...FUNCTIONS_SOURCE_PATHSPECS],
    top,
  )
  stamp = dirty ? `${sha}${DIRTY_STAMP_SUFFIX}` : sha
  if (dirty) {
    console.warn(
      `\nDeploying UNCOMMITTED cloud/functions changes; stamping ${stamp}.\n` +
        'check:functions-drift will report every function DIRTY until a deploy ' +
        'from a clean checkout:\n' +
        dirty
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n') +
        '\n',
    )
  }
} catch (error) {
  console.warn(
    `\nCannot read git here (${String(error.message).split('\n')[0]}); deploying ` +
      `without ${SOURCE_STAMP_ENV}. check:functions-drift will report every ` +
      'function UNSTAMPED.\n',
  )
}

const hadDotenv = existsSync(dotenvPath)
const next = withSourceStamp(hadDotenv ? readFileSync(dotenvPath, 'utf8') : '', stamp)
if (hadDotenv || next) {
  if (hadDotenv && lstatSync(dotenvPath).isSymbolicLink()) unlinkSync(dotenvPath)
  // The dotenv holds tokens; a file this creates is owner-only, and an
  // existing one keeps its own mode.
  writeFileSync(dotenvPath, next, { mode: 0o600 })
}
if (stamp) console.log(`Stamped ${SOURCE_STAMP_ENV}=${stamp} into cloud/functions/.env`)
