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
 * Duplicate keys in a JSON document, at any depth (AGL-3553).
 *
 * `JSON.parse` keeps the LAST of two equal keys in one object and says
 * nothing, so a duplicate is invisible to every reader that parses the file.
 * Two lanes each added a `transferResources` key to the same plugin entry in
 * `plugins.config.json`; git merged both with no conflict, and the second
 * silently replaced the first. Only a reader that walks the TEXT can see the
 * two, which is what this is: a small tokenizer that tracks the keys of every
 * open object and reports each one written twice.
 *
 * It reads JSONC as well as JSON — `//` and block comments and a trailing
 * comma are stepped over — because several tracked configs (`tsconfig*.json`,
 * `.vscode/*.json`) are JSONC, and a duplicate there is just as silent.
 */

/**
 * @typedef {{ key: string, path: string, line: number, column: number, firstLine: number }} DuplicateKey
 * @typedef {{ ok: true, duplicates: DuplicateKey[] } | { ok: false, error: string, line: number, column: number }} ScanResult
 */

/**
 * Every key written twice in one object of `text`, with where each repeat
 * sits — or why the text is not JSON at all.
 *
 * @param {string} text
 * @returns {ScanResult}
 */
export function findDuplicateKeys(text) {
  let at = 0
  let line = 1
  let lineStart = 0
  /** @type {DuplicateKey[]} */
  const duplicates = []

  class ScanError extends Error {}
  const fail = (message) => {
    const error = new ScanError(message)
    error.line = line
    error.column = at - lineStart + 1
    throw error
  }

  const skipSpaceAndComments = () => {
    while (at < text.length) {
      const char = text[at]
      if (char === '\n') {
        line += 1
        at += 1
        lineStart = at
      } else if (char === ' ' || char === '\t' || char === '\r' || char === '﻿') {
        at += 1
      } else if (char === '/' && text[at + 1] === '/') {
        while (at < text.length && text[at] !== '\n') at += 1
      } else if (char === '/' && text[at + 1] === '*') {
        const end = text.indexOf('*/', at + 2)
        if (end === -1) fail('An unclosed block comment.')
        for (let i = at; i < end; i += 1) {
          if (text[i] === '\n') {
            line += 1
            lineStart = i + 1
          }
        }
        at = end + 2
      } else {
        return
      }
    }
  }

  /** A string literal, decoded, so `"a"` and `"a"` are the same key. */
  const readString = () => {
    const start = at
    at += 1
    while (at < text.length && text[at] !== '"') {
      if (text[at] === '\n') fail('A string runs past the end of its line.')
      at += text[at] === '\\' ? 2 : 1
    }
    if (at >= text.length) fail('An unclosed string.')
    at += 1
    try {
      return JSON.parse(text.slice(start, at))
    } catch {
      return fail('A string holds an escape JSON does not allow.')
    }
  }

  const readScalar = () => {
    const match = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
      text.slice(at, at + 64),
    )
    if (!match) fail(`Unexpected ${JSON.stringify(text[at] ?? 'end of file')}.`)
    at += match[0].length
  }

  const readValue = (path) => {
    skipSpaceAndComments()
    const char = text[at]
    if (char === '{') readObject(path)
    else if (char === '[') readArray(path)
    else if (char === '"') readString()
    else readScalar()
  }

  const readArray = (path) => {
    at += 1
    let index = 0
    for (;;) {
      skipSpaceAndComments()
      if (text[at] === ']') {
        at += 1
        return
      }
      readValue(`${path}[${index}]`)
      index += 1
      skipSpaceAndComments()
      if (text[at] === ',') at += 1
      else if (text[at] !== ']') fail('Expected `,` or `]` in an array.')
    }
  }

  const readObject = (path) => {
    at += 1
    /** @type {Map<string, number>} the line each key was first written on */
    const seen = new Map()
    for (;;) {
      skipSpaceAndComments()
      if (text[at] === '}') {
        at += 1
        return
      }
      if (text[at] !== '"') fail('Expected a quoted key.')
      const keyLine = line
      const keyColumn = at - lineStart + 1
      const key = readString()
      const keyPath = `${path}.${key}`
      const first = seen.get(key)
      if (first === undefined) seen.set(key, keyLine)
      else duplicates.push({ key, path: keyPath, line: keyLine, column: keyColumn, firstLine: first })
      skipSpaceAndComments()
      if (text[at] !== ':') fail('Expected `:` after a key.')
      at += 1
      readValue(keyPath)
      skipSpaceAndComments()
      if (text[at] === ',') at += 1
      else if (text[at] !== '}') fail('Expected `,` or `}` in an object.')
    }
  }

  try {
    readValue('$')
    skipSpaceAndComments()
    if (at < text.length) fail('Text after the end of the document.')
    return { ok: true, duplicates }
  } catch (error) {
    if (!(error instanceof ScanError)) throw error
    return { ok: false, error: error.message, line: error.line, column: error.column }
  }
}

/** The tracked files the guard reads: every `.json` and `.jsonc`. */
export function isSwept(path) {
  return /\.jsonc?$/.test(path)
}

/**
 * The verdict over many files. A file that does not read as JSON is an
 * offence too: a guard that skipped what it could not parse would pass the
 * file most likely to be hiding something.
 *
 * @param {Array<{ path: string, text: string }>} files
 */
export function evaluateDuplicateKeys(files) {
  const offenders = []
  for (const { path, text } of files) {
    const result = findDuplicateKeys(text)
    if (result.ok === false) offenders.push({ path, unreadable: result })
    else if (result.duplicates.length) offenders.push({ path, duplicates: result.duplicates })
  }
  return { ok: offenders.length === 0, offenders }
}

/** The failure, one line per repeat, each naming both lines so the fix is a merge of the two. */
export function formatFailure(verdict) {
  const lines = []
  for (const offender of verdict.offenders) {
    if (offender.unreadable) {
      const { error, line, column } = offender.unreadable
      lines.push(`  ${offender.path}:${line}:${column}  not JSON: ${error}`)
      continue
    }
    for (const dup of offender.duplicates) {
      lines.push(
        `  ${offender.path}:${dup.line}:${dup.column}  ${dup.path} is written twice ` +
          `(first on line ${dup.firstLine}); JSON.parse keeps only this one`,
      )
    }
  }
  return (
    `\n${lines.join('\n')}\n\n` +
    'Merge each pair into ONE key holding everything both meant to say — usually two ' +
    'branches each added the key, and git joined them without a conflict. Deleting ' +
    'either copy drops what the other lane wrote.'
  )
}
