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
 * `re2js` as the BROWSER sees it: a name that refuses rather than 143 KB of
 * regular-expression engine no page runs (AGL-2706).
 *
 * `@firebase/firestore` depends on `re2js` and imports `RE2JS` at the top of
 * its browser ESM bundle, so the engine is unconditionally in the client
 * graph. It is read from exactly three places — `CoreLike`,
 * `CoreRegexContains` and `CoreRegexMatch` — the client-side evaluators for
 * the Firestore **Pipelines** expression API. Nothing in this repo builds a
 * pipeline, and `RE2JS` has no other reader in the SDK.
 *
 * Throwing is the correct refusal rather than a hazard: each of the three call
 * sites already wraps `RE2JS.compile` in `try`/`catch`, logs a warning and
 * returns an error `EvaluateResult`. A pipeline that reached one of these
 * would degrade to "this expression could not be evaluated", never to an
 * unhandled exception.
 *
 * A native `RegExp` shim was the other option and is deliberately NOT what
 * this is. RE2 is in that SDK because the pattern it compiles comes from a
 * query, and a backtracking engine on an attacker-chosen pattern is a
 * denial-of-service. Substituting `RegExp` would trade weight for a ReDoS
 * path; refusing trades weight for a feature nothing uses.
 *
 * Only the `browser` condition is aliased here, so Node — the server bundles,
 * the functions, every test — still resolves the real package.
 */

const unavailable = () => {
  throw new Error(
    're2js is not bundled for the browser: Firestore Pipelines regular-' +
      'expression evaluation is unavailable on the client. See ' +
      'tools/build/re2js-unavailable.browser.js.',
  )
}

export const RE2JS = {
  compile: unavailable,
  matches: unavailable,
  quote: unavailable,
}

export default RE2JS
