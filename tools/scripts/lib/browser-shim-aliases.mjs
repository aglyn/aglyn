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
 * The vendored assumption underneath each `browser` resolve alias (AGL-2706).
 *
 * `with-aglyn.nextjs.config.js` redirects two specifiers to modules that carry
 * a name and no implementation, for browser bundles only. Together they took
 * 48.7 KB gzipped off every console route — and both are correct only because
 * of facts about code this repo does not own:
 *
 *   re2js                        every reader of `RE2JS` inside
 *                                `@firebase/firestore`'s browser bundle is
 *                                inside a `try` block, so a throwing stub
 *                                degrades to the SDK's own logged error path.
 *   next/dist/compiled/buffer    the last mention of `Buffer` in that same
 *                                bundle is an `instanceof`, which needs a
 *                                constructor to compare against and nothing
 *                                more.
 *
 * A dependency bump can end either at any time, silently. A typecheck is blind
 * to a vendored bundle, no test evaluates a Firestore Pipeline, and a build
 * gets quieter rather than louder when a stub is substituted. So the
 * assumptions are pinned here instead of asserted in a comment.
 *
 * ## What is checked, and what is not
 *
 * - the alias is still declared, and its target file still exists;
 * - inside the vendored bundle, every reference to the shimmed binding still
 *   has the shape the shim was chosen for.
 *
 * NOT checked: that the SDK's `catch` does something sensible with the error.
 * That is the SDK's business, and re-deriving it here would be a second copy
 * of their code with the same expiry date as the first.
 *
 * NOT checked either: the rest of `node_modules`. A repo-wide sweep for the
 * word `Buffer` would be a grep, not a check — it would go red on a
 * server-only dependency that never reaches a browser, and teach people to
 * ignore it. The scope is the bundle that made each alias necessary.
 */

/**
 * The `browser`-conditioned aliases this module pins.
 *
 * `safety` names the property that makes a name-without-an-implementation
 * survivable, and picks the predicate below that decides it.
 */
export const SHIMMED = [
  {
    specifier: 're2js',
    shim: 'tools/build/re2js-unavailable.browser.js',
    binding: 'RE2JS',
    vendored: '@firebase/firestore',
    safety: 'try-guarded',
    why:
      'Firestore imports RE2JS for the Pipelines expression evaluators — ' +
      'CoreLike, CoreRegexContains, CoreRegexMatch — and reads it nowhere ' +
      'else. Each wraps the call in try/catch, logs, and returns an error ' +
      'result, so a stub that throws degrades one expression rather than a ' +
      'page.',
  },
  {
    specifier: 'next/dist/compiled/buffer',
    shim: 'tools/build/buffer-unavailable.browser.js',
    binding: 'Buffer',
    vendored: '@firebase/firestore',
    safety: 'instanceof-only',
    why:
      'The one mention left in the client graph is `t instanceof Buffer` in ' +
      "Firestore's resume-token assertion, on the branch a browser's proto3 " +
      'JSON serializer never takes. `instanceof` needs a constructor, not an ' +
      'implementation.',
  },
]

/**
 * Spans of `[start, end]` covered by a `try { … }` block.
 *
 * A brace matcher rather than a regex: these bodies are minified onto one
 * line, so "the text between `try {` and the next `}`" is wrong by whole
 * function bodies. String and comment contents are not skipped — an
 * unbalanced brace inside a literal could only WIDEN a span, which is why the
 * caller refuses to read a zero-site result as clean.
 *
 * @param {string} source
 * @returns {[number, number][]}
 */
export function tryBlockSpans(source) {
  const spans = []
  const opener = /\btry\s*\{/g
  let match
  while ((match = opener.exec(source))) {
    const start = match.index + match[0].length - 1
    let depth = 0
    let at = start
    for (; at < source.length; at++) {
      const char = source[at]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth === 0) spans.push([start, at])
  }
  return spans
}

/**
 * Where `binding` is CALLED, indexed, or read a property from.
 *
 * The shapes that can throw, and the only ones a stub has to survive. Written
 * as a positive test for a dangerous shape rather than by first stripping
 * comments, which is what the first version of this did and what made it
 * wrong: `@firebase/firestore` carries three prose mentions of `Buffer` in a
 * comment ABOUT the one `instanceof` beside it, and they read as three
 * unguarded uses.
 *
 * Stripping would have fixed that and introduced a worse failure. A comment
 * stripper has to know where string and regex literals are, these bundles are
 * minified onto one line, and a regex containing `//` would blank the rest of
 * the file — hiding a real use and printing green. Matching the shape needs no
 * such knowledge, and its residual error is a comment that happens to spell
 * `Buffer.from`, which is a false RED.
 */
export function usageSites(source, binding) {
  const found = []
  const pattern = new RegExp(`\\b${binding}\\s*[.([]`, 'g')
  let match
  while ((match = pattern.exec(source))) found.push(match.index)
  return found
}

/** Where `binding` is only compared against — `x instanceof Binding`. */
export function instanceofSites(source, binding) {
  const found = []
  const pattern = new RegExp(`instanceof\\s+${binding}\\b`, 'g')
  let match
  while ((match = pattern.exec(source))) found.push(match.index)
  return found
}

/**
 * Uses of `binding` that do NOT have the shape `safety` requires.
 *
 * `try-guarded` — every call sits inside a `try` block, so a stub that throws
 * is caught by code that already handles the failure.
 *
 * `instanceof-only` — there are NO calls at all, so the binding is only ever
 * compared against and a bare constructor is a complete substitute.
 *
 * @returns {{ sites: number[], failing: number[] }}
 */
export function unsafeUses(source, binding, safety) {
  const sites = usageSites(source, binding)
  if (safety === 'instanceof-only')
    return {
      sites: [...sites, ...instanceofSites(source, binding)],
      failing: sites,
    }
  const spans = tryBlockSpans(source)
  return {
    sites,
    failing: sites.filter(
      (at) => !spans.some(([from, to]) => at > from && at < to),
    ),
  }
}

/**
 * One shimmed specifier's verdict over the vendored bundles that mention it.
 *
 * `files` is the caller's list of `{ path, source }` — resolving them is
 * filesystem work and stays in the CLI so this module can be tested against
 * strings.
 *
 * No files at all is `unknown` rather than clean: the file list is wrong, and
 * a run that read nothing established nothing. Files with no sites is
 * `absent`, which IS clean — the vendored code stopped using the binding, so
 * there is nothing left for the shim to be wrong about, and the alias is now
 * dead weight rather than load-bearing.
 */
export function verdictFor(shim, files) {
  const perFile = files.map(({ path, source }) => ({
    path,
    ...unsafeUses(source, shim.binding, shim.safety),
  }))
  const sites = perFile.reduce((sum, one) => sum + one.sites.length, 0)
  const failing = perFile.filter((one) => one.failing.length)
  if (!files.length)
    return { ...shim, state: 'unknown', perFile, sites, failing }
  if (!sites) return { ...shim, state: 'absent', perFile, sites, failing }
  return {
    ...shim,
    state: failing.length ? 'unsafe' : 'ok',
    perFile,
    sites,
    failing,
  }
}

export const WHY_SHIM_ALIAS =
  'A `browser` resolve alias in with-aglyn.nextjs.config.js replaces this ' +
  'specifier with a module that carries the name and no implementation, so a ' +
  'browser downloads a few bytes instead of a library. That is safe only ' +
  'while the vendored code uses the binding in the shape the shim was chosen ' +
  'for. If it changed, either delete the alias and accept the weight, or ' +
  'establish that the new use is unreachable in a browser and record which ' +
  'shape now applies in SHIMMED.'
