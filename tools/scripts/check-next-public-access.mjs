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
 * Refuse bracket access to `NEXT_PUBLIC_*` outside provably server-only code
 * (AGL-2037, AGL-2172).
 *
 * ## The defect this closes, which has now shipped three times
 *
 * Next inlines `NEXT_PUBLIC_*` into browser and edge bundles by textually
 * substituting the member expression `process.env.NAME`. The **bracket** form
 * is never substituted, so in a browser it reads `undefined` and the constant
 * silently collapses to whatever default sits behind it.
 *
 * That is not a style question, it is a configuration failing closed onto
 * Aglyn's values:
 *
 *  - `tenant-dns.ts` — the custom-domain wizard printed OUR CNAME target and
 *    Vercel's IPs to a self-hoster's customer, who would then create that DNS
 *    record. Regardless of what the operator configured (AGL-2037).
 *  - `besigner/.../docs-help.ts` — every help link pointed at docs.aglyn.com.
 *  - `plugins/mui/plugin.tsx` — the plugin sandbox origin.
 *
 * Each was found and fixed one at a time. AGL-2037 asked for the class to be
 * checked instead, and this is that.
 *
 * ## The rule, and why it needs no allowlist
 *
 * Bracket access is legitimate — and preferable — in server-only code: it is
 * never substituted, which is exactly what you want for a value that must not
 * reach the client bundle. So the rule is not "never brackets", it is "brackets
 * only where the file is provably server-only", and the repo already expresses
 * that in its paths: `app/api/` (route handlers) and any `server/` directory.
 *
 * Measured when this was written: 11 files used the bracket form, 8 of them
 * under those two paths and correct, 3 outside them and all 3 broken. A rule
 * that reads a path convention the repo already follows stays true without
 * anyone maintaining a list — an allowlist would need a new row per legitimate
 * server module, and a row nobody re-reads is the AGL-2002 shape.
 *
 * Exit codes: 0 clean · 1 a client-reachable module reads NEXT_PUBLIC_ by
 * bracket.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SWEEP_ROOTS = ['apps', 'libs', 'cloud']
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.nx',
  'tmp',
  '.turbo',
  '.git',
])
const SWEPT = /\.(?:tsx?|jsx?|mjs|cjs)$/

/** Bracket access with either quote style. */
const BRACKET = /process\.env\[\s*['"]NEXT_PUBLIC_[A-Z0-9_]+['"]\s*\]/g

/**
 * Provably server-only by path. A route handler and anything under a `server/`
 * directory never reaches a browser bundle, so the bracket form there is
 * correct rather than tolerated.
 */
const SERVER_ONLY = [/(^|\/)app\/api\//, /(^|\/)server\//]

/** Naming the pattern is what these files are FOR. */
const EXEMPT = [
  /\.spec\.[cm]?[jt]sx?$/,
  /\.test\.[cm]?[jt]sx?$/,
  /^tools\//,
]

function sweptFiles(dir, found = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sweptFiles(full, found)
      continue
    }
    if (SWEPT.test(entry.name)) found.push(full)
  }
  return found
}

const files = SWEEP_ROOTS.flatMap((root) => sweptFiles(join(REPO_ROOT, root)))
const offences = []

for (const file of files) {
  const path = relative(REPO_ROOT, file).split(sep).join('/')
  if (EXEMPT.some((pattern) => pattern.test(path))) continue
  if (SERVER_ONLY.some((pattern) => pattern.test(path))) continue
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  lines.forEach((line, index) => {
    for (const match of line.matchAll(BRACKET))
      offences.push({ path, line: index + 1, text: match[0] })
  })
}

console.log(
  `NEXT_PUBLIC access form · ${files.length} files swept · ` +
    `${offences.length} bracket read(s) outside server-only paths`,
)

// Guard the premise: a walk that reached nothing would report zero offences
// and read as a pass, which is the failure this repo keeps rediscovering.
if (files.length < 3000) {
  console.error(
    `\nFAIL: swept only ${files.length} files — the walk is not reaching the ` +
      'corpus, so a clean verdict would be meaningless.',
  )
  process.exit(1)
}

for (const one of offences) console.log(`  ${one.path}:${one.line}  ${one.text}`)

if (offences.length) {
  console.log(
    '\nUse dot notation. Next substitutes `process.env.NAME` textually and ' +
      'never the bracket form, so in a browser or edge bundle the read above ' +
      'is `undefined` and the value silently falls back to its default — ' +
      "which on a self-host install means Aglyn's (AGL-2037). If the module " +
      'really is server-only, its path should say so: `app/api/**` or ' +
      'a `server/` directory.',
  )
  process.exit(1)
}

console.log('\nEvery client-reachable NEXT_PUBLIC read uses the inlined form.')
