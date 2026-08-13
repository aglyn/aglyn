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
 * AGL-1479: the ONE comment stripper the source-guard specs share.
 *
 * A handful of specs in this app assert over source TEXT rather than over a
 * render, because what they pin is a property of a declaration — which function
 * a value goes through, which handler re-reads a collection — inside components
 * that mount Firestore listener stacks and would otherwise be tests of the
 * mocks. Those specs have to look at CODE, not prose: the comments below a fix
 * NAME the shape the fix replaced, so a negative assertion would pass against
 * the explanation of the bug rather than against its absence.
 *
 * Each of them carried its own copy of the stripper, and four of the five
 * copies were:
 *
 * ```ts
 * source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
 * ```
 *
 * which reads `accept="image/*"` in `media-library.component.tsx` as a block
 * comment opener and deletes everything up to the next `*\/` — **16,383
 * characters**, including the bulk MOVE TO FOLDER picker. The assertions those
 * specs carry are mostly negative, so a hole in the middle of the subject makes
 * them pass MORE reliably, and for no reason at all. That is the failure this
 * module exists to make impossible, so the bounds below are enforced rather
 * than documented: a stripper that silently drops most of its input is the
 * defect, and a regex cannot be trusted to police itself.
 *
 * @see `source-text.spec.ts` for the proof that both traps are seen.
 */

/**
 * A JSX comment, and ONLY a JSX comment.
 *
 * The body may not itself contain `*\/`, or `interface Props {` followed by a
 * JSDoc field comment matches as far as the next `*\/ }` — measured at 122,857
 * characters of `media-library.component.tsx`, four fifths of the file.
 */
const JSX_COMMENT = /\{\s*\/\*(?:[^*]|\*(?!\/))*\*\/\s*\}/g

/**
 * A block comment, recognised only where one can START a line — never wherever
 * a `/*` happens to appear inside an attribute, a string or a MIME type.
 */
const LINE_LEADING_BLOCK = /^[ \t]*\/\*[\s\S]*?\*\//gm

/** A line comment, sparing the `//` in a `https://` URL. */
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm

/**
 * The longest run a single comment may claim.
 *
 * Chosen against what the guarded sources actually contain: the longest real
 * comment in any of them is the 2,034-character module header of
 * `app/api/media/restore/route.ts`. The `accept="image/*"` hole was 16,383
 * characters (16,932 when AGL-1479 was filed), so this bound sits comfortably
 * above every legitimate comment and an order of magnitude below the defect.
 *
 * This is the assertion that bites. The fraction below cannot be: the hole took
 * `media-library.component.tsx` from 153,593 characters to 95,980 — 62% still
 * standing, which no sane whole-file ratio would have flagged.
 */
export const MAX_STRIPPED_SPAN = 3_000

/**
 * How much of a source must survive being stripped.
 *
 * The backstop for a total collapse rather than a hole — the un-`*`-safe JSX
 * pattern above leaves 20% of the library standing. Set against the most
 * comment-dense source guarded here, `app/api/health/route.ts`, of which 30.4%
 * is code.
 */
export const MIN_KEPT_FRACTION = 0.25

function withoutBlocks(source: string, pattern: RegExp, label: string): string {
  return source.replace(pattern, (match: string) => {
    if (match.length > MAX_STRIPPED_SPAN) {
      throw new Error(
        `${label}: the comment stripper claimed ${match.length} characters as ` +
          `one comment, past the ${MAX_STRIPPED_SPAN}-character bound. That is ` +
          `not a comment, it is an opener the regex mis-read, and every ` +
          `negative assertion downstream of it would pass for the wrong ` +
          `reason (AGL-1479). It starts: ${JSON.stringify(match.slice(0, 160))}`,
      )
    }
    return ''
  })
}

/**
 * `source` with its comments removed, or a thrown error explaining which bound
 * it broke.
 *
 * Pass the whole file and slice the RESULT — do not strip a slice. The bounds
 * are calibrated against whole sources, and a slice that happens to be mostly
 * JSDoc is not the failure this is looking for.
 *
 * @param label how the source should be named if it trips a bound.
 * @param minKept the fraction that must survive. Pass `0` — and only `0` — for
 *   a sweep over MANY files, where a legitimate near-empty re-export page is
 *   90% licence header and the ratio says nothing. {@link MAX_STRIPPED_SPAN}
 *   still applies, and it is the bound that catches the AGL-1479 shape.
 */
export function code(
  source: string,
  label = 'source',
  minKept = MIN_KEPT_FRACTION,
): string {
  const stripped = withoutBlocks(
    withoutBlocks(source, JSX_COMMENT, label),
    LINE_LEADING_BLOCK,
    label,
  ).replace(LINE_COMMENT, '$1')

  if (stripped.length < source.length * minKept) {
    throw new Error(
      `${label}: stripping comments left ${stripped.length} of ${source.length} ` +
        `characters (${((100 * stripped.length) / source.length).toFixed(1)}%), ` +
        `below the ${(100 * minKept).toFixed(0)}% floor. A stripper that drops ` +
        `most of its input makes every assertion over the result meaningless ` +
        `(AGL-1479).`,
    )
  }

  return stripped
}
