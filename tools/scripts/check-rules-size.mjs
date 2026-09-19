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

/**
 * Fail when a security rules source is too big to deploy (AGL-3027).
 *
 * ```
 * npm run check:rules-size
 * node tools/scripts/check-rules-size.mjs --root <checkout>   # e.g. a pinned release worktree
 * ```
 *
 * The v1.0.0-beta.125 Firestore rules compiled, passed the emulator matrix
 * and passed `check:rules-parse`, and the deploy refused them for being 17
 * bytes over a limit none of those look at. This measures each rules source
 * against the limit its own service applies. The limits, where each comes
 * from, and why a compile cannot see them live in `lib/rules-size.mjs`.
 *
 * In GitHub Actions a NEAR or OVER verdict is also written as a workflow
 * annotation, so a warning on a green step is visible on the run rather than
 * only in its log.
 *
 * Exit codes, and the third one on purpose, as in `check:rules-parse`: a
 * check that examined nothing has not passed.
 *
 *   0 every source is under its limit (a NEAR warning still exits 0)
 *   1 a source is at or over its limit, so its deploy will be refused
 *   2 could not check: a source is missing or unreadable, or the arguments
 *     were not understood
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RULES_SOURCES,
  formatRulesSize,
  judgeRulesSize,
  measureRulesSource,
} from './lib/rules-size.mjs'

const USAGE = 'usage: node tools/scripts/check-rules-size.mjs [--root <checkout>]'

/**
 * `--root <dir>` and nothing else. An unrecognized argument stops the run
 * rather than being ignored: `--roots ../release` silently measuring THIS
 * checkout would be a green about the wrong files.
 */
function parseArgs(argv) {
  let root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      root = resolve(argv[i + 1])
      i += 1
      continue
    }
    return { error: `check:rules-size: cannot use argument \`${argv[i]}\`.\n${USAGE}` }
  }
  return { root }
}

/** A workflow command's message may not carry raw `%`, CR or LF. */
const annotationText = (text) =>
  text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

const args = parseArgs(process.argv.slice(2))
if (args.error) {
  console.error(args.error)
  process.exit(2)
}

const inActions = process.env.GITHUB_ACTIONS === 'true'
let over = 0
let near = 0
let unreadable = 0

console.log('check:rules-size: each rules source against the limit its deploy enforces (AGL-3027)')
for (const source of RULES_SOURCES) {
  let content
  try {
    content = readFileSync(join(args.root, source.path))
  } catch (error) {
    unreadable += 1
    console.error(`CANNOT CHECK  ${source.path}: ${error.code ?? error.message}`)
    continue
  }
  const judgement = judgeRulesSize({
    bytes: measureRulesSource(content),
    limitBytes: source.limitBytes,
  })
  const lines = formatRulesSize(source, judgement)
  if (judgement.verdict === 'ok') {
    console.log(lines.join('\n'))
    continue
  }
  const isOver = judgement.verdict === 'over'
  if (isOver) {
    over += 1
    console.error(lines.join('\n'))
  } else {
    near += 1
    console.log(lines.join('\n'))
  }
  if (inActions) {
    const level = isOver ? 'error' : 'warning'
    const title = isOver ? 'Rules source over its deploy limit' : 'Rules source near its deploy limit'
    const body = lines.map((line) => line.trim()).join(' ')
    console.log(`::${level} file=${source.path},title=${title}::${annotationText(body)}`)
  }
}

const total = RULES_SOURCES.length
if (over > 0) {
  console.error(
    `\ncheck:rules-size: ${over} of ${total} rules source(s) at or over the limit; the deploy will refuse them.`,
  )
  process.exit(1)
}
if (unreadable > 0) {
  console.error(
    `\ncheck:rules-size: CANNOT CHECK ${unreadable} of ${total} rules source(s) under ${args.root}.\n` +
      '  Exiting 2 rather than 0: a check that examined nothing has not passed.',
  )
  process.exit(2)
}
console.log(
  `\ncheck:rules-size: all ${total} rules sources are under their limits` +
    (near > 0 ? `; ${near} NEAR the limit, see above.` : '.'),
)
