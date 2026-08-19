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
 * `apps/docs` must not phone home (AGL-2124).
 *
 * The docs site ships in the open-source distribution and an operator can
 * build and publish it as their own product documentation. Three values in it
 * were bare literals — our GA4 measurement id, our error collector's URL, and
 * our production origins on the /status page — and every one of them made a
 * self-hosted build REPORT TO AGLYN: their readers' pageviews in our property,
 * their stack traces in our Error Reporting, our uptime printed as theirs.
 *
 * The rule is not "make it configurable". It is **unset means OFF, never
 * ours**: a missing analytics id must mean "no analytics", never "Aglyn's".
 * So this check reads for the LITERALS, in the files that reach an operator's
 * build, and refuses them regardless of how they got there — a default
 * expression is as reportable as an assignment.
 *
 * Pure so it can be tested without a filesystem; `check-docs-self-host.mjs`
 * supplies the real files.
 */

/**
 * Each pattern names an Aglyn-operated endpoint or identifier. Deliberately
 * NOT a blanket `aglyn` search: the docs are Aglyn's product documentation and
 * say so on every page. What must not survive is a value the software ACTS on.
 */
export const FORBIDDEN_LITERALS = [
  {
    // Our GA4 measurement id, in any file. A build that compiles this in
    // reports a stranger's readers into the property we read the September
    // activation funnel from.
    pattern: /G-[A-Z0-9]{8,}/,
    what: 'a GA4 measurement id',
    fix: 'read DOCS_GA_TRACKING_ID; unset must mean no gtag at all',
  },
  {
    pattern: /https:\/\/app\.aglyn\.com/,
    what: 'Aglyn’s production console origin',
    fix: 'read it from customFields (DOCS_ERROR_BEACON_ENDPOINT / DOCS_STATUS_TARGETS)',
  },
  {
    pattern: /https:\/\/demo\.aglyn\.com/,
    what: 'Aglyn’s demo tenant origin',
    fix: 'read it from customFields (DOCS_STATUS_TARGETS)',
  },
]

/**
 * @param {Array<{ path: string, source: string }>} files
 * @returns {{ ok: boolean, checked: number, findings: Array<{ path: string, line: number, what: string, fix: string, text: string }> }}
 */
export function evaluateDocsSelfHost(files) {
  const findings = []
  for (const file of files ?? []) {
    const lines = String(file?.source ?? '').split('\n')
    lines.forEach((text, index) => {
      // A comment explaining the defect is not the defect. Every fix in this
      // area leaves one behind, and a check that cannot tell them apart gets
      // deleted rather than obeyed.
      //
      // The `[^:]` is load-bearing and cost this check its first RED: a naive
      // `//.*$` strip eats everything after the `//` in `https://`, so the one
      // literal it exists to catch was invisible to it. The forced-RED run is
      // the only reason that was found.
      const code = text
        .replace(/(^|[^:])\/\/.*$/, '$1')
        .replace(/^\s*\*.*$/, '')
      for (const rule of FORBIDDEN_LITERALS) {
        if (rule.pattern.test(code)) {
          findings.push({
            path: file.path,
            line: index + 1,
            what: rule.what,
            fix: rule.fix,
            text: text.trim(),
          })
        }
      }
    })
  }
  return { ok: findings.length === 0, checked: (files ?? []).length, findings }
}

/** @param {ReturnType<typeof evaluateDocsSelfHost>} result */
export function formatDocsSelfHostFailure(result) {
  const lines = [
    'apps/docs would report to Aglyn on a self-host build (AGL-2124).',
    '',
  ]
  for (const finding of result.findings) {
    lines.push(
      `  ${finding.path}:${finding.line}  ${finding.what}` +
        `\n    ${finding.text}` +
        `\n    fix: ${finding.fix}`,
    )
  }
  lines.push(
    '',
    '  Unset must mean OFF, never ours. A missing analytics id means "no',
    '  analytics"; it must never mean "Aglyn’s".',
  )
  return lines.join('\n')
}
