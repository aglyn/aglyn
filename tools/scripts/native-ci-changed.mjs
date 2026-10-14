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

// Decides whether the native Kotlin and Swift tests run (AGL-3704), each on
// its own (AGL-3783): a Kotlin-only change never needs a macOS runner.
//
//   node tools/scripts/native-ci-changed.mjs --base <sha> [--head <sha>]
//
// Prints the native-relevant changed paths and writes `kotlin=true|false`,
// `swift=true|false`, `run=true|false` (either) and `reason=…` to
// $GITHUB_OUTPUT when it is set. An unknown or unreachable base runs
// everything: "what changed is unknown" is answered by running, never by
// skipping. Exits 0 either way; only bad arguments exit non-zero.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, readlinkSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

import { listedModules, nativePathsByPlatform, usableBase } from './lib/native-ci-changed.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const args = process.argv.slice(2)
const arg = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
if (args.includes('--help')) {
  console.log('usage: native-ci-changed.mjs --base <sha> [--head <sha>]')
  process.exit(0)
}
const base = arg('--base') ?? ''
const head = arg('--head') || 'HEAD'

const git = (...gitArgs) =>
  execFileSync('git', gitArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(join(repoRoot, file), 'utf8'))
  } catch {
    return undefined
  }
}

/** Every tracked symlink in the head tree, with its repo-relative target. */
function trackedLinks() {
  const links = []
  for (const line of git('ls-files', '-s', '-z').split('\0')) {
    if (!line.startsWith('120000 ')) continue
    const path = line.slice(line.indexOf('\t') + 1)
    try {
      const target = posix.normalize(posix.join(posix.dirname(path), readlinkSync(join(repoRoot, path))))
      if (!target.startsWith('../') && !target.startsWith('/')) links.push({ path, target })
    } catch {
      // Not checked out as a link (core.symlinks off): nothing to follow.
    }
  }
  return links
}

const ALL = { kotlin: true, swift: true }

function decide() {
  if (!usableBase(base)) return { ...ALL, reason: `no usable base (${base || 'none'}): running everything` }
  let mergeBase
  try {
    mergeBase = git('merge-base', base, head)
  } catch {
    return { ...ALL, reason: `base ${base} is not in this checkout: running everything` }
  }
  const changed = git('diff', '--name-only', '--no-renames', mergeBase, head).split('\n').filter(Boolean)
  const modules = listedModules({
    contracts: readJson('tools/scripts/native-contracts.json'),
    pureModules: readJson('tools/scripts/mobile-pure-modules.json'),
  })
  const sides = nativePathsByPlatform(changed, modules, trackedLinks())
  const relevant = [...new Set([...sides.kotlin, ...sides.swift])]
  for (const path of relevant.slice(0, 50)) {
    const tag = sides.kotlin.includes(path) ? (sides.swift.includes(path) ? 'both  ' : 'kotlin') : 'swift '
    console.log(`  ${tag} ${path}`)
  }
  if (relevant.length > 50) console.log(`  … and ${relevant.length - 50} more`)
  const kotlin = sides.kotlin.length > 0
  const swift = sides.swift.length > 0
  return {
    kotlin,
    swift,
    reason:
      relevant.length > 0
        ? `${relevant.length} of ${changed.length} changed paths are native-relevant (kotlin ${sides.kotlin.length}, swift ${sides.swift.length})`
        : `none of ${changed.length} changed paths is native-relevant: fast pass`,
  }
}

const { kotlin, swift, reason } = decide()
const run = kotlin || swift
console.log(`kotlin=${kotlin} swift=${swift}: ${reason}`)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `kotlin=${kotlin}\nswift=${swift}\nrun=${run}\nreason=${reason}\n`)
}
