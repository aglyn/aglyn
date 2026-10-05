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
 * Write, or check, the Firestore rules deploy artifact (AGL-3544).
 *
 * ```
 * npm run generate:rules-deploy                 # write cloud/firebase-firestore.deploy.rules
 * npm run check:rules-deploy                    # fail when the committed artifact is stale
 * node tools/scripts/generate-rules-deploy-artifact.mjs --check --staged   # the index, for pre-commit
 * node tools/scripts/generate-rules-deploy-artifact.mjs --check --root <checkout>
 * ```
 *
 * `cloud/firebase-firestore.rules` is the documented source and the only one
 * anybody edits. `cloud/firebase-firestore.deploy.rules` is that file without
 * its comments, and it is what `cloud/firebase.json`, the emulators, the
 * rules tests and `deploy-firestore-rules.mjs` all load. The transform and why
 * it keeps the line numbers are in `lib/rules-deploy-artifact.mjs`.
 *
 * The artifact is committed rather than built on demand, so a fresh checkout,
 * the emulator configs and the drift checker's `git show <ref>:<path>` all
 * find the bytes that deploy without running anything first. The price is
 * that it can go stale, and `--check` is what stops a stale one merging.
 *
 * Exit codes:
 *   0 the artifact was written, or (--check) it matches the source
 *   1 (--check) the artifact is missing or stale
 *   2 could not run: the source is unreadable or does not scan, or the
 *     arguments were not understood
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FIRESTORE_RULES_ARTIFACT,
  FIRESTORE_RULES_SOURCE,
  GENERATE_COMMAND,
  buildRulesArtifact,
  judgeRulesArtifact,
} from './lib/rules-deploy-artifact.mjs'

const USAGE =
  'usage: node tools/scripts/generate-rules-deploy-artifact.mjs [--check [--staged]] [--root <checkout>]'

function parseArgs(argv) {
  const parsed = {
    check: false,
    staged: false,
    root: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') {
      parsed.check = true
    } else if (arg === '--staged') {
      parsed.staged = true
    } else if (arg === '--root' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      parsed.root = resolve(argv[i + 1])
      i += 1
    } else {
      return { error: `generate-rules-deploy-artifact: cannot use argument \`${arg}\`.\n${USAGE}` }
    }
  }
  if (parsed.staged && !parsed.check) {
    return { error: `generate-rules-deploy-artifact: --staged only checks; it never writes.\n${USAGE}` }
  }
  return parsed
}

/** A path's content from the working tree, or from the index with --staged. */
function reader({ root, staged }) {
  if (!staged) return (path) => readFileSync(join(root, path), 'utf8')
  return (path) =>
    execFileSync('git', ['show', `:${path}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
}

const args = parseArgs(process.argv.slice(2))
if (args.error) {
  console.error(args.error)
  process.exit(2)
}

const read = reader(args)
const where = args.staged ? 'the index' : args.root

let source
try {
  source = read(FIRESTORE_RULES_SOURCE)
} catch (error) {
  console.error(`CANNOT RUN  ${FIRESTORE_RULES_SOURCE} in ${where}: ${error.code ?? error.message}`)
  process.exit(2)
}

if (!args.check) {
  let artifact
  try {
    artifact = buildRulesArtifact(source)
  } catch (error) {
    console.error(`CANNOT RUN  ${FIRESTORE_RULES_SOURCE}: ${error.message}`)
    process.exit(2)
  }
  writeFileSync(join(args.root, FIRESTORE_RULES_ARTIFACT), artifact)
  const from = Buffer.byteLength(source, 'utf8')
  const to = Buffer.byteLength(artifact, 'utf8')
  console.log(
    `wrote ${FIRESTORE_RULES_ARTIFACT}: ${to.toLocaleString('en-US')} bytes ` +
      `from ${from.toLocaleString('en-US')} in ${FIRESTORE_RULES_SOURCE}`,
  )
  process.exit(0)
}

let artifact = null
try {
  artifact = read(FIRESTORE_RULES_ARTIFACT)
} catch {
  // Missing is a verdict of its own, reported below.
}

let judgement
try {
  judgement = judgeRulesArtifact({ source, artifact })
} catch (error) {
  console.error(`CANNOT RUN  ${FIRESTORE_RULES_SOURCE}: ${error.message}`)
  process.exit(2)
}

if (judgement.verdict === 'fresh') {
  console.log(`ok    ${FIRESTORE_RULES_ARTIFACT} matches ${FIRESTORE_RULES_SOURCE} in ${where}`)
  process.exit(0)
}

const what =
  judgement.verdict === 'missing'
    ? `${FIRESTORE_RULES_ARTIFACT} is missing from ${where}`
    : `${FIRESTORE_RULES_ARTIFACT} is stale in ${where}, from line ${judgement.firstDifferentLine}`
console.error(
  [
    `STALE ${what}.`,
    `      It is ${FIRESTORE_RULES_SOURCE} without its comments, and it is the file that deploys:`,
    '      a rules edit that does not regenerate it is tested, emulated and deployed as the OLD rules.',
    `      Run \`${GENERATE_COMMAND}\` and commit ${FIRESTORE_RULES_ARTIFACT} with the source.`,
  ].join('\n'),
)
process.exit(1)
