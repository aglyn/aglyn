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

// The pure half of the NUL-byte guard (AGL-1890).
//
// ## What a raw NUL in tracked source costs
//
// git decides text-or-binary by looking for a NUL in the first 8000 bytes of
// a blob. One NUL inside that prefix and the file is BINARY for every tool
// that reads git: `git diff` prints "Binary files a/… and b/… differ",
// `git log -p` shows nothing, `git blame` is empty, `git add -p` cannot stage
// a hunk, and every review surface — GitHub's, a reviewer's terminal, an
// agent's — shows `Bin 0 -> 6718 bytes` where the code should be. `grep(1)`
// skips the file too, so it is invisible to a codebase search as well.
//
// The consequence is not cosmetic. A file in that state has never been
// reviewed and cannot be: not the commit that introduced it and not any
// commit since. `apps/console/utils/analytics-day-cache.ts` shipped 6.7 KB of
// caching logic in exactly that state (AGL-1440, 2026-08-12) and stayed there
// for six days. When it was finally read as text it held two real defects
// nobody had had the chance to see.
//
// ## Why this checks EVERY byte and not just git's prefix
//
// AGL-1323 removed the repo's one known NUL and recorded that it was the only
// one. Two more appeared within fifteen days, and one of them —
// `apps/console/specs/media-upload-quarantine.spec.ts` — sat at byte 9188,
// past git's 8000-byte window. git called it text, so nothing was visibly
// wrong with it, and it would have flipped the whole file to binary the
// moment an edit above it added ~1200 bytes. A guard that reproduced git's
// heuristic would have passed that file and then gone red later on an
// unrelated commit that merely moved it. So the rule here is stricter and
// simpler than git's: no raw NUL anywhere in a swept file, at any offset.
//
// ## The fix is always the same
//
// Every NUL found so far was deliberate string data — a cache-key separator,
// a fake malware signature — and every one of them is written `\x00` (or
// `\u0000`) instead. A JS/TS string or template literal parses the escape to
// the identical one-character string, so there is no behaviour to preserve
// beyond the parse, and the file stays reviewable.

/**
 * Extensions swept, as an allowlist rather than a binary denylist.
 *
 * This repo tracks real binary assets — PNG, ICO, JPEG, GIF, and any format
 * added later — which are FULL of NULs and must stay that way. A denylist
 * ("skip .png, .ico, …") would go red the first time someone commits a `.webp`
 * or a `.woff2`, and the obvious way to silence that red is to add another
 * skip, which is how an allowlist ends up rotting into a rubber stamp.
 *
 * An allowlist fails the other way: a text format nobody listed is simply not
 * swept, which is a gap, not a false red — and `check-nul-bytes.mjs` prints
 * the swept count so a gap that swallowed the corpus is visible.
 */
export const SWEPT_EXTENSIONS = Object.freeze([
  // Source
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  // Markup, style, data, config
  'json',
  'jsonc',
  'md',
  'mdx',
  'yml',
  'yaml',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'htm',
  'svg',
  'xml',
  'toml',
  'ini',
  'properties',
  'graphql',
  'sql',
  'rules',
  'txt',
  'csv',
  // Shell
  'sh',
  'bash',
  'zsh',
])

const SWEPT = new Set(SWEPT_EXTENSIONS)

/**
 * Whether a repo-relative path is one this guard reads.
 *
 * @param {string} path Repo-relative, forward-slashed.
 * @returns {boolean}
 */
export function isSwept(path) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return SWEPT.has(name.slice(dot + 1).toLowerCase())
}

/** git's own text-or-binary window. A NUL below this makes the blob binary. */
export const GIT_BINARY_WINDOW_BYTES = 8000

/**
 * Every NUL in a buffer, located for a human.
 *
 * Line and column are 1-based and counted over `\n`, which is what an editor
 * and a stack trace agree on. `preview` is the offending line with the NUL
 * rendered as `\x00` — printing the raw byte would make the guard's OWN output
 * unreadable in the terminal that is trying to report it.
 *
 * @param {Buffer|Uint8Array} bytes
 * @returns {Array<{offset: number, line: number, column: number, preview: string}>}
 */
export function findNulBytes(bytes) {
  const found = []
  let line = 1
  let lineStart = 0
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte === 0x0a) {
      line += 1
      lineStart = index + 1
      continue
    }
    if (byte !== 0x00) continue
    let lineEnd = index
    while (lineEnd < bytes.length && bytes[lineEnd] !== 0x0a) lineEnd += 1
    const raw = Buffer.from(bytes.subarray(lineStart, lineEnd)).toString('utf8')
    found.push({
      offset: index,
      line,
      column: index - lineStart + 1,
      preview: raw.split('\u0000').join('\\x00').trim().slice(0, 100),
    })
  }
  return found
}

/**
 * The verdict over an already-read corpus, so the self-test can drive every
 * branch without a filesystem.
 *
 * `binaryToGit` distinguishes the two shapes this guard covers: a NUL inside
 * git's 8000-byte window is ALREADY doing the damage — that file is binary
 * today and its diffs are gone — while one beyond it is a landmine that flips
 * the file the next time anything above it grows. Both fail; the report says
 * which, because "this file has never been reviewable" and "this file is one
 * edit away from that" are different sentences to hand a reader.
 *
 * @param {Array<{path: string, bytes: Buffer|Uint8Array}>} files
 * @returns {{ok: boolean, offenders: Array<{path: string, count: number, binaryToGit: boolean, hits: ReturnType<typeof findNulBytes>}>}}
 */
export function evaluateNulBytes(files) {
  const offenders = []
  for (const file of files) {
    const hits = findNulBytes(file.bytes)
    if (!hits.length) continue
    offenders.push({
      path: file.path,
      count: hits.length,
      binaryToGit: hits[0].offset < GIT_BINARY_WINDOW_BYTES,
      hits,
    })
  }
  offenders.sort((a, b) => a.path.localeCompare(b.path))
  return { ok: offenders.length === 0, offenders }
}

/**
 * The failure a human reads.
 *
 * @param {ReturnType<typeof evaluateNulBytes>} verdict
 * @returns {string}
 */
export function formatFailure(verdict) {
  const lines = []
  for (const one of verdict.offenders) {
    lines.push(
      `\n${one.path} — ${one.count} raw NUL byte(s)` +
        (one.binaryToGit
          ? '  [BINARY TO GIT: this file has no diff, no blame, and cannot be reviewed]'
          : `  [latent: first at byte ${one.hits[0].offset}, past git's ${GIT_BINARY_WINDOW_BYTES}-byte window — ` +
            'the file reads as text only until something above it grows]'),
    )
    for (const hit of one.hits)
      lines.push(
        `  ${String(hit.line).padStart(5)}:${hit.column}  ${hit.preview}`,
      )
  }
  lines.push(
    '\nWrite the NUL as the `\\x00` escape instead. A JS/TS string or template ' +
      'literal parses it to the identical one-character string, so nothing ' +
      'about the value changes — and the file stays something a reviewer, a ' +
      'blame, and a grep can actually see (AGL-1323, AGL-1890).',
  )
  return lines.join('\n')
}
