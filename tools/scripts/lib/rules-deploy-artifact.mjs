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

// The pure half of the Firestore rules deploy artifact (AGL-3544).
//
// ## Why the deployed file is not the source
//
// The Rules API refuses a ruleset source of 256 KiB or more, and it counts
// comments (`lib/rules-size.mjs` has the measurements). About four fifths of
// `cloud/firebase-firestore.rules` is the comments that explain it, so the
// file reached the limit long before its rules did. The source keeps every
// comment; what deploys is `cloud/firebase-firestore.deploy.rules`, the same
// text with the comments removed.
//
// ## What the transform does, and does not do
//
// One left-to-right scan with four states: code, a string literal, a line
// comment and a block comment. Whichever delimiter appears first wins, so a
// `/*` quoted inside a line comment is text (the AGL-2004 trap the rules tests
// already document), an apostrophe inside a comment opens no string, and a
// `//` inside a string literal (a URL in a `matches()` pattern) is kept.
//
//   - A line comment is removed up to, not including, its newline.
//   - A block comment becomes ONE space, so `a/*x*/b` cannot fuse into `ab`,
//     and every newline it spanned is kept.
//   - Outside string literals, runs of spaces and tabs collapse to one space,
//     and each line is trimmed. Inside a literal not one byte changes.
//
// Every newline survives, so the artifact has exactly as many lines as the
// source and line N of one is line N of the other. A compile error the
// emulator or the deploy reports against the artifact names the line to open
// in the source. Keeping the blank lines costs about 3 KB, measured on the
// AGL-3544 source; renumbered errors would cost every reader of one.
//
// Nothing here understands the rules grammar, and nothing needs to: removing
// comments and inter-token whitespace is all it does. The equivalence is
// proved where it matters, by `npm run test:rules` loading the ARTIFACT into
// the emulator, and by `check:rules-parse` compiling it.

/** The documented source, which people edit. */
export const FIRESTORE_RULES_SOURCE = 'cloud/firebase-firestore.rules'

/** What `cloud/firebase.json` and the deploy script ship. Never edited by hand. */
export const FIRESTORE_RULES_ARTIFACT = 'cloud/firebase-firestore.deploy.rules'

/** The command that writes the artifact, as the messages tell people to run it. */
export const GENERATE_COMMAND = 'npm run generate:rules-deploy'

/**
 * Appended to the artifact's first line. A trailing comment, not a line of
 * its own, so the line numbering stays the source's.
 */
export const ARTIFACT_MARKER =
  ` // GENERATED from firebase-firestore.rules by \`${GENERATE_COMMAND}\`; edit that file, never this one (AGL-3544).`

/**
 * The source with its comments and redundant whitespace removed, line for
 * line.
 *
 * Throws on a source the scan cannot vouch for: an unterminated block comment
 * or string literal, or a string literal that spans a line. Each is a source
 * that would not compile, and an artifact built from it would carry the fault
 * under a different shape.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripRulesComments(source) {
  const lines = []
  /** The current output line, as segments: code (collapsible) or literal. */
  let segments = []
  let code = ''
  let state = 'code'
  let quote = ''
  let literal = ''
  let line = 1
  let openedAt = 0

  const flushCode = () => {
    if (code) segments.push({ kind: 'code', text: code })
    code = ''
  }
  const endLine = () => {
    flushCode()
    lines.push(renderLine(segments))
    segments = []
    line += 1
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code'
        endLine()
      }
      continue
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code'
        index += 1
      } else if (char === '\n') {
        endLine()
      }
      continue
    }

    if (state === 'string') {
      if (char === '\n' || char === '\r') {
        throw new SyntaxError(`line ${openedAt}: a string literal runs past the end of its line`)
      }
      literal += char
      if (char === '\\') {
        if (next === undefined || next === '\n' || next === '\r') {
          throw new SyntaxError(`line ${openedAt}: a string literal runs past the end of its line`)
        }
        literal += next
        index += 1
        continue
      }
      if (char === quote) {
        segments.push({ kind: 'literal', text: literal })
        literal = ''
        state = 'code'
      }
      continue
    }

    // state === 'code'
    if (char === '/' && next === '/') {
      state = 'line-comment'
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      state = 'block-comment'
      openedAt = line
      code += ' '
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      flushCode()
      state = 'string'
      quote = char
      literal = char
      openedAt = line
      continue
    }
    if (char === '\n') {
      endLine()
      continue
    }
    code += char
  }

  if (state === 'block-comment') {
    throw new SyntaxError(`line ${openedAt}: a block comment is never closed`)
  }
  if (state === 'string') {
    throw new SyntaxError(`line ${openedAt}: a string literal is never closed`)
  }
  flushCode()
  lines.push(renderLine(segments))
  return lines.join('\n')
}

/**
 * One output line: spaces collapsed in the code between literals, the
 * literals untouched, the whole trimmed. A carriage return counts as
 * whitespace, so a CRLF source yields LF lines.
 */
function renderLine(segments) {
  return segments
    .map((segment) =>
      segment.kind === 'literal' ? segment.text : segment.text.replace(/[ \t\r\f\v]+/g, ' '),
    )
    .join('')
    .trim()
}

/**
 * The artifact for a source: stripped, the marker on line one, one trailing
 * newline.
 *
 * @param {string} source
 * @returns {string}
 */
export function buildRulesArtifact(source) {
  const lines = stripRulesComments(source).replace(/\n+$/, '').split('\n')
  lines[0] = `${lines[0]}${ARTIFACT_MARKER}`.trimStart()
  return `${lines.join('\n')}\n`
}

/**
 * Is the committed artifact the one the source builds? `stale` names the
 * first differing line, so the message points somewhere.
 *
 * @param {{ source: string, artifact: string | null }} input
 * @returns {{ verdict: 'fresh' | 'stale' | 'missing', expected: string, firstDifferentLine?: number }}
 */
export function judgeRulesArtifact({ source, artifact }) {
  const expected = buildRulesArtifact(source)
  if (artifact === null) return { verdict: 'missing', expected }
  if (artifact === expected) return { verdict: 'fresh', expected }
  const want = expected.split('\n')
  const have = artifact.split('\n')
  let index = 0
  while (index < want.length && want[index] === have[index]) index += 1
  return { verdict: 'stale', expected, firstDifferentLine: index + 1 }
}
