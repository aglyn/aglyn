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
 * A scanner for the "every writer" guards: where tracked source WRITES a
 * document of one host subcollection, and what it writes (AGL-3330).
 *
 * A write is found by the reference it names — spelled at the call
 * (`updateDoc(doc(db, 'hosts', h, '<collection>', id), data)`,
 * `….collection('<collection>').doc(id).update(data)`,
 * `tx.update(….doc(id), data)`), parked in a `const` and written through
 * later, or handed in under the one name a caller passes it by. What a guard
 * then asks of the data is the guard's business.
 *
 * Source text, not a render: what is pinned is which helper the data goes
 * through, which is legible in the source and would survive being mocked out
 * of a render test.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const REPO_ROOT = resolve(__dirname, '../../..')

/**
 * The source without its comments, which name the shapes a guard refuses.
 *
 * A scanner rather than the shared `code()` stripper, for the reason
 * `admin-audit-writes-are-stamped.spec.ts` gives: a module header on a file
 * the sweep reaches can be longer than that stripper's bound. Strings and
 * template literals are stepped over whole, so a `//` inside one is kept.
 */
export function withoutComments(source: string): string {
  let out = ''
  let at = 0
  while (at < source.length) {
    const char = source[at]
    const next = source[at + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', at)
      at = end === -1 ? source.length : end
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2)
      at = end === -1 ? source.length : end + 2
    } else if (char === "'" || char === '"' || char === '`') {
      let end = at + 1
      while (end < source.length && source[end] !== char) end += source[end] === '\\' ? 2 : 1
      out += source.slice(at, end + 1)
      at = end + 1
    } else {
      out += char
      at += 1
    }
  }
  return out
}

/** Where the argument starting at `from` ends: its closing bracket or a comma at depth 0. */
function argumentEnd(source: string, from: number): number {
  let depth = 0
  let at = from
  while (at < source.length) {
    const char = source[at]
    if (char === "'" || char === '"' || char === '`') {
      let end = at + 1
      while (end < source.length && source[end] !== char) end += source[end] === '\\' ? 2 : 1
      at = end + 1
      continue
    }
    if (char === '(' || char === '{' || char === '[') depth += 1
    else if (char === ')' || char === '}' || char === ']') {
      if (depth === 0) break
      depth -= 1
    } else if (char === ',' && depth === 0) break
    at += 1
  }
  return at
}

/** One write to a document: how it writes, what it writes, and where. */
export interface DocumentWrite {
  /** `update`, `set`, `create`, `updateDoc` or `setDoc`. */
  method: string
  /** The data argument, as written. */
  data: string
  /** Whether a `{ merge: true }` option follows the data. */
  merge: boolean
  /** The call, for a failure message. */
  at: string
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The regex source of a reference to one document of `collection` under a
 * host or an organization: the parent collection spelled (`'hosts'`) or held
 * in a variable (`scopeCollection`), which is how a surface that serves both
 * scopes addresses its documents.
 */
export function hostDocumentRef(collection: string): string {
  const name = escape(collection)
  const arg = String.raw`[^,()]+(?:\([^()]*\))?`
  const parent = String.raw`(?:'\w+'|[\w$.]+)`
  const web = String.raw`doc\(\s*[\w$.]+\s*,\s*${parent}\s*,\s*${arg}\s*,\s*'${name}'\s*,\s*${arg}\s*\)`
  const admin = String.raw`\.collection\(\s*'${name}'\s*\)\s*\.doc\(\s*[^()]*(?:\([^()]*\))?[^()]*\)`
  return `(?:${web}|${admin})`
}

/**
 * Every write to a document of `collection` in one comment-free source.
 *
 * @param passedRef - the name a reference is handed in by (`formRef`), which
 *                    also matches it as a field (`options.formRef`).
 */
export function documentWrites(
  source: string,
  collection: string,
  passedRef?: string,
): DocumentWrite[] {
  const ref = hostDocumentRef(collection)
  const names = new Set<string>()
  for (const match of source.matchAll(
    new RegExp(String.raw`(?:const|let)\s+([\w$]+)\s*=\s*[\w$.()']*?${ref}`, 'g'),
  )) {
    names.add(match[1])
  }
  const refs = [
    ref,
    ...(passedRef ? [String.raw`(?:[\w$]+\.)?${escape(passedRef)}\b`] : []),
    ...[...names].map((name) => String.raw`\b${escape(name)}\b`),
  ]
  const target = `(?:${refs.join('|')})`
  // What may precede the reference inside the call: its receiver chain.
  const receiver = '[^,;{}]*?'
  const shapes = [
    // updateDoc(ref, data) / setDoc(ref, data)
    new RegExp(String.raw`\b(updateDoc|setDoc)\(\s*${receiver}${target}\s*,\s*`, 'g'),
    // ref.update(data) / .set / .create
    new RegExp(String.raw`${target}\s*\.(update|set|create)\(\s*`, 'g'),
    // tx.update(ref, data) / batch.set / transaction.create
    new RegExp(String.raw`\b[\w$]+\.(update|set|create)\(\s*${receiver}${target}\s*,\s*`, 'g'),
  ]
  const writes: DocumentWrite[] = []
  for (const shape of shapes) {
    for (const match of source.matchAll(shape)) {
      const from = (match.index ?? 0) + match[0].length
      const end = argumentEnd(source, from)
      writes.push({
        method: match[1],
        data: source.slice(from, end).trim(),
        merge: /^\s*,\s*\{\s*merge\s*:\s*true/.test(source.slice(end, end + 40)),
        at: source.slice(match.index ?? 0, from + 60).replace(/\s+/g, ' '),
      })
    }
  }
  return writes
}

/** Whether a write replaces or creates the document rather than editing it. */
export function isCreate(write: DocumentWrite): boolean {
  return write.method === 'create' || (/^set/i.test(write.method) && !write.merge)
}

/** The top-level keys of an object literal, as written; `null` for anything else. */
export function literalKeys(data: string): string[] | null {
  if (!data.startsWith('{') || !data.endsWith('}')) return null
  const body = data.slice(1, -1)
  const keys: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at <= body.length; at += 1) {
    const char = body[at]
    if (char === "'" || char === '"' || char === '`') {
      let end = at + 1
      while (end < body.length && body[end] !== char) end += body[end] === '\\' ? 2 : 1
      at = end
      continue
    }
    if (char === '(' || char === '{' || char === '[') depth += 1
    else if (char === ')' || char === '}' || char === ']') depth -= 1
    if ((char === ',' && depth === 0) || at === body.length) {
      const entry = body.slice(start, at).trim()
      if (entry) keys.push(entry.split(':')[0].trim())
      start = at + 1
    }
  }
  return keys
}

/** Tracked TypeScript and module sources, specs and rules tests excluded. */
export function trackedSources(): string[] {
  return execSync('git ls-files "*.ts" "*.tsx" "*.mjs"', {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter((file) => !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file))
    .filter((file) => !file.includes('/specs/') && !file.includes('rules-tests/'))
}

/** One tracked source as written. */
export function readSource(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8')
}

/** One tracked source, comments stripped. */
export function readCode(file: string): string {
  return withoutComments(readSource(file))
}
