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
// Specs that still assert a string literal a push changed (AGL-2837).
//
// ## The break this exists for
//
// `551bdd32f` changed console copy from "licences" to "licenses". The panel's
// spec still asserted `/this workspace holds no licences/i`, so a test shard
// went red on the next full sweep and `main` stayed red for 3 h 19 min. The
// diff looked like a spelling fix, and no seconds-scale check read the spec.
//
// ## Why it matches so narrowly
//
// A literal counts only when it was CHANGED IN PLACE: a removed line and an
// added line in the same hunk carry two literals a small edit apart. Replayed
// over the last sixty commits on `main`, flagging every REMOVED literal marked
// four commits whose specs were passing (fixtures, a test title, a detector's
// own sample) and missed the real break; the changed-in-place rule found that
// break and nothing else.
//
// The old literal must also be GONE: present, as a whole word and in any case,
// in no non-spec file under apps/, libs/ or cloud/. Copy that survives
// elsewhere is copy a spec may still legitimately assert.
//
// Specs are searched case-insensitively because they assert rendered copy
// through `/.../i` regexes. Test titles and negative assertions are skipped:
// naming the old copy there is not asserting that it renders.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE = /\.(?:tsx?|jsx?|mjs|cjs)$/
const SPEC = /\.(?:spec|test)\.[cm]?[jt]sx?$/
const GENERATED = /\.generated\.[cm]?[jt]sx?$/
const QUOTED = /(['"`])((?:\\.|(?!\1).){4,160}?)\1/g
const JSX_TEXT = />\s*([^<>{}\n]{4,160}?)\s*</g
const TITLE = /\b(?:it|test|describe)(?:\.(?:each|only|skip)(?:\([^)]*\))?)?\s*\(/
const NEGATIVE = /\bnot\.|queryBy|toBeNull|toBeUndefined|doesNotMatch|notTo/

/** Literals past this many are not searched; a push that large is a merge. */
export const MAX_LITERALS = 400

/** The string literals and JSX text on one line that read as copy. */
export function literalsOf(line) {
  const found = []
  for (const match of String(line).matchAll(QUOTED)) found.push(match[2])
  for (const match of String(line).matchAll(JSX_TEXT)) found.push(match[1])
  return found
    .map((text) => text.trim())
    .filter((text) => text.length >= 4 && /[A-Za-z]{3,}/.test(text) && !text.includes('${'))
    .filter((text) => !/^[@./]/.test(text) && !/^[\w.-]+\/[\w./@-]*$/.test(text))
    // Copy has a space or reads as one capitalized word. An identifier does
    // neither, so camelCase, PascalCase and CONSTANT_CASE are dropped.
    .filter((text) => /\s/.test(text) || /^[A-Z][a-z]+$/.test(text))
}

/** Levenshtein distance, or `Infinity` once the lengths alone exceed `limit`. */
export function editDistance(a, b, limit = 3) {
  if (Math.abs(a.length - b.length) > limit) return Infinity
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

/**
 * Literals changed in place, read from a `git diff -U0`: old literal to the
 * literal that replaced it and the file it changed in.
 *
 * @returns {Map<string, { next: string, file: string }>}
 */
export function changedLiterals(diffText) {
  const pairs = new Map()
  let file = ''
  let removed = []
  let added = []
  const flush = () => {
    for (const old of removed) {
      if (pairs.has(old) || added.includes(old)) continue
      const allowed = Math.max(1, Math.floor(old.length * 0.2))
      const next = added.find(
        (candidate) =>
          candidate.toLowerCase() !== old.toLowerCase() && editDistance(old, candidate) <= allowed,
      )
      if (next) pairs.set(old, { next, file })
    }
    removed = []
    added = []
  }
  for (const line of String(diffText).split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      file = line.split(' b/')[1] ?? ''
      continue
    }
    if (line.startsWith('@@')) {
      flush()
      continue
    }
    if (!SOURCE.test(file) || SPEC.test(file) || GENERATED.test(file)) continue
    if (line.startsWith('-') && !line.startsWith('---')) removed.push(...literalsOf(line.slice(1)))
    else if (line.startsWith('+') && !line.startsWith('+++')) added.push(...literalsOf(line.slice(1)))
  }
  flush()
  return pairs
}

const withoutRev = (line) => line.replace(/^[0-9a-f]{7,40}:/, '')

/**
 * Spec lines from `git grep -n` output that still assert a gone literal.
 *
 * @param {{ hits: string, gone: string[], pairs: Map<string, { next: string, file: string }> }} input
 */
export function specFindings({ hits, gone, pairs }) {
  const findings = []
  for (const hit of String(hits).split('\n')) {
    const body = withoutRev(hit)
    const first = body.indexOf(':')
    const second = body.indexOf(':', first + 1)
    if (first < 0 || second < 0) continue
    const text = body.slice(second + 1)
    if (TITLE.test(text) || NEGATIVE.test(text)) continue
    const lower = text.toLowerCase()
    for (const literal of gone) {
      if (!lower.includes(literal.toLowerCase())) continue
      const pair = pairs.get(literal)
      findings.push({
        spec: body.slice(0, first),
        line: Number(body.slice(first + 1, second)),
        literal,
        now: pair?.next ?? '',
        changedIn: pair?.file ?? '',
      })
    }
  }
  return findings
}

/**
 * Specs that still assert a literal the range `base..head` changed in place.
 * Reads git objects only, never the working tree, so a peer's uncommitted
 * edit in a shared checkout cannot change the answer.
 *
 * @param {{ base: string, head: string, git: (args: string[], opts?: { allowNoMatch?: boolean }) => string }} input
 */
export function findStaleLiteralSpecs({ base, head, git }) {
  const diff = git(['diff', '-U0', '--no-color', '--no-renames', base, head, '--', 'apps', 'libs', 'cloud'])
  const pairs = changedLiterals(diff)
  if (!pairs.size) return []
  const literals = [...pairs.keys()].slice(0, MAX_LITERALS)
  const dir = mkdtempSync(join(tmpdir(), 'aglyn-stale-literals-'))
  try {
    const changedFile = join(dir, 'changed.txt')
    writeFileSync(changedFile, `${literals.join('\n')}\n`)
    const survivors = new Set(
      git(
        ['grep', '-F', '-i', '-w', '-o', '-h', '-I', '-f', changedFile, head, '--', 'apps', 'libs', 'cloud', ':(exclude)*.spec.*', ':(exclude)*.test.*'],
        { allowNoMatch: true },
      )
        .split('\n')
        .map((line) => withoutRev(line).toLowerCase())
        .filter(Boolean),
    )
    const gone = literals.filter((literal) => !survivors.has(literal.toLowerCase()))
    if (!gone.length) return []
    const goneFile = join(dir, 'gone.txt')
    writeFileSync(goneFile, `${gone.join('\n')}\n`)
    const hits = git(
      ['grep', '-F', '-i', '-n', '-I', '-f', goneFile, head, '--', 'apps/**/*.spec.*', 'apps/**/*.test.*', 'libs/**/*.spec.*', 'libs/**/*.test.*'],
      { allowNoMatch: true },
    )
    return specFindings({ hits, gone, pairs })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
