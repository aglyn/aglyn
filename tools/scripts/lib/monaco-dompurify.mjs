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

// Holds the four DISMISSED DOMPurify Dependabot alerts to the reason they were
// dismissed for (AGL-2300, superseding the record on AGL-2051).
//
// THE SITUATION THIS GUARDS
//
// `monaco-editor` vendors DOMPurify into its own source tree and inlines it
// into the prebuilt AMD bundle that `tools/scripts/lib/sync-monaco-assets.js`
// copies into `apps/console/public/monaco/vs`. That bundle — not
// `node_modules/dompurify`, which is our own patched 3.4.13 — is what the
// browser executes when someone opens the besigner's Edit -> Raw JSON.
//
// The vendored copy is 3.4.8 and no released monaco carries a newer one, so
// there is nowhere to upgrade to. It is NOT true, and never was, that the
// vendored copy is unused: `esm/vs/base/browser/domSanitize.js` imports it and
// every markdown render inside the editor runs through it. The dismissals rest
// on something narrower and checkable — that monaco never turns on the four
// CONFIGURATION SURFACES the four advisories need:
//
//   GHSA-55q2-fjhq-7xh7  medium, XSS  needs `IN_PLACE` + an element-removing hook
//   GHSA-cmwh-pvxp-8882  medium       needs the persistent-config `setConfig()`
//   GHSA-c2j3-45gr-mqc4  low          needs `CUSTOM_ELEMENT_HANDLING`
//   GHSA-vxr8-fq34-vvx9  low          needs `TRUSTED_TYPES_POLICY` + `clearConfig()`
//
// WHY IT IS A GUARD AND NOT A COMMENT
//
// Monaco already registers an element-detaching `uponSanitizeElement` hook
// (`replaceWithPlainTextHook`), which is one half of GHSA-55q2-fjhq-7xh7's
// precondition. The only thing between us and that XSS is that monaco does not
// pass `IN_PLACE` — one line, in a package we do not control, that no human
// reviews on a Dependabot bump. A precondition-based dismissal whose
// preconditions nobody re-measures silently stops being true.
//
// HOW THE DETECTOR TELLS "PASSED" FROM "READ"
//
// The bundle contains the DOMPurify library itself, so every option name
// appears in it — as a READ off the config parameter (`N.IN_PLACE||!1`). What
// matters is whether monaco PASSES one, which in an object literal is the
// `TOKEN:` form. `SENTINEL_OPTION` is an option monaco genuinely does pass, so
// a corpus where even the sentinel is absent means the scan is pointed at the
// wrong bytes — that fails rather than passing vacuously.

// MARK – GLOBALS

/** The monaco release whose DOMPurify posture has actually been read. */
export const REVIEWED_MONACO_VERSION = '0.56.0'

/** The DOMPurify version that release inlines into `min/vs`. */
export const REVIEWED_DOMPURIFY_VERSION = '3.4.8'

/**
 * Options whose PRESENCE in a passed config re-opens an advisory. Matched in
 * the `TOKEN:` object-literal form — see the detector note above.
 */
export const FORBIDDEN_OPTIONS = [
  { token: 'IN_PLACE', advisory: 'GHSA-55q2-fjhq-7xh7' },
  { token: 'CUSTOM_ELEMENT_HANDLING', advisory: 'GHSA-c2j3-45gr-mqc4' },
  { token: 'TRUSTED_TYPES_POLICY', advisory: 'GHSA-vxr8-fq34-vvx9' },
]

/**
 * DOMPurify's persistent-config API. Both are EXPORTED by the bundled library
 * whether or not anyone calls them, so the definition (`e.setConfig=function`)
 * is not evidence of anything — only a `.setConfig(` CALL is.
 */
export const FORBIDDEN_CALLS = [
  { token: 'setConfig', advisory: 'GHSA-cmwh-pvxp-8882' },
  { token: 'clearConfig', advisory: 'GHSA-vxr8-fq34-vvx9' },
]

/** An option monaco really does pass — the detector's positive control. */
export const SENTINEL_OPTION = 'RETURN_DOM_FRAGMENT'

/** Marks a bundle chunk as one DOMPurify was inlined into. */
const DOMPURIFY_MARKER = /dompurify/i

/** DOMPurify stamps its own version onto the export. */
const VERSION_PATTERN = /\.version="([\d.]+)"/g

// MARK – MAIN

/**
 * Decide whether the shipped monaco bundle still matches the posture the four
 * DOMPurify dismissals were written against.
 *
 * @param {Object} options
 * @param {string} options.monacoVersion `version` from monaco-editor's manifest.
 * @param {Array<{ path: string, source: string }>} options.files Every `.js`
 *   under the package's `min/vs`.
 * @returns {{ ok: boolean, failures: Array<{ kind: string, detail: string }>,
 *   bundles: string[], dompurifyVersion: string | undefined }}
 */
export function evaluateMonacoDompurify({ monacoVersion, files }) {
  const failures = []
  const matched = files.filter((file) => DOMPURIFY_MARKER.test(file.source))
  const bundles = matched.map((file) => file.path)

  if (!matched.length) {
    // Not "nothing to worry about" — monaco stopped looking the way this
    // guard understands, so the dismissals are no longer backed by anything.
    failures.push({
      kind: 'no-bundle',
      detail:
        `no chunk under min/vs mentions DOMPurify (${files.length} .js file(s) scanned). ` +
        'Either the vendoring moved or the scan is pointed at the wrong tree.',
    })
    return { ok: false, failures, bundles, dompurifyVersion: undefined }
  }

  if (!matched.some((file) => file.source.includes(`${SENTINEL_OPTION}:`))) {
    failures.push({
      kind: 'sentinel-missing',
      detail:
        `none of ${bundles.join(', ')} passes \`${SENTINEL_OPTION}:\`, which monaco's ` +
        'sanitize call always does. The option detector below would report a ' +
        'clean bill of health it has not earned, so this fails instead.',
    })
  }

  const versions = new Set()
  for (const file of matched) {
    for (const [, version] of file.source.matchAll(VERSION_PATTERN)) {
      versions.add(version)
    }
  }
  const dompurifyVersion = versions.size === 1 ? [...versions][0] : undefined

  if (versions.size !== 1) {
    failures.push({
      kind: 'version-unreadable',
      detail:
        `expected exactly one \`.version="x.y.z"\` in the DOMPurify chunk(s), found ` +
        `${versions.size} (${[...versions].join(', ') || 'none'}). The bundled ` +
        'DOMPurify version can no longer be read, so it cannot be pinned.',
    })
  } else if (dompurifyVersion !== REVIEWED_DOMPURIFY_VERSION) {
    failures.push({
      kind: 'dompurify-moved',
      detail:
        `monaco now inlines DOMPurify ${dompurifyVersion}, reviewed against ` +
        `${REVIEWED_DOMPURIFY_VERSION}. If it is newer, the four dismissed ` +
        'alerts may now be genuinely patched and should be re-opened/closed on ' +
        'their merits rather than left dismissed.',
    })
  }

  if (monacoVersion !== REVIEWED_MONACO_VERSION) {
    failures.push({
      kind: 'monaco-moved',
      detail:
        `monaco-editor is ${monacoVersion}, reviewed against ` +
        `${REVIEWED_MONACO_VERSION}. Re-read domSanitize.js, then move the pin ` +
        'in this file in the same commit as the bump.',
    })
  }

  for (const { token, advisory } of FORBIDDEN_OPTIONS) {
    const hits = matched.filter((file) => file.source.includes(`${token}:`))
    if (hits.length) {
      failures.push({
        kind: 'option-passed',
        detail:
          `\`${token}:\` is passed in ${hits.map((f) => f.path).join(', ')}. ` +
          `That is the precondition ${advisory} needs, so the dismissal of that ` +
          'alert no longer holds.',
      })
    }
  }

  for (const { token, advisory } of FORBIDDEN_CALLS) {
    const hits = matched.filter((file) => file.source.includes(`.${token}(`))
    if (hits.length) {
      failures.push({
        kind: 'call-site',
        detail:
          `\`.${token}(\` is CALLED in ${hits.map((f) => f.path).join(', ')}. ` +
          `That is the precondition ${advisory} needs, so the dismissal of that ` +
          'alert no longer holds.',
      })
    }
  }

  return { ok: !failures.length, failures, bundles, dompurifyVersion }
}

/**
 * Render a failing {@link evaluateMonacoDompurify} result for a CI log.
 *
 * @param {ReturnType<typeof evaluateMonacoDompurify>} result
 * @returns {string}
 */
export function formatMonacoDompurifyFailure(result) {
  const lines = [
    "monaco-editor's vendored DOMPurify no longer matches the posture the four",
    'dismissed Dependabot alerts (685, 747, 757, 758) were dismissed for.',
    '',
  ]
  for (const failure of result.failures) {
    lines.push(`  [${failure.kind}] ${failure.detail}`)
  }
  lines.push(
    '',
    'Do NOT silence this by moving the pin without reading the code. The four',
    'alerts are dismissed on the claim that monaco never turns on the config',
    'surfaces they need; this guard is the only thing checking that claim.',
    'See AGL-2300 for the analysis and AGL-2051 for the original bump.',
  )
  return lines.join('\n')
}
