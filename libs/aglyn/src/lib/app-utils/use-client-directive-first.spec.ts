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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * `'use client'` must be the FIRST statement in its file (AGL-2153).
 *
 * A React directive is only a directive in the directive prologue. Put one
 * import above it and it degrades into an ordinary string expression: the
 * module silently stops being a client module, and Turbopack rejects the file
 * outright with `Ecmascript file had an error`.
 *
 * Nothing in the promotion gate could see it. `tsc` is happy — a bare string
 * literal is a valid expression statement. jest is happy — the directive is
 * meaningless under the jest transform, so every one of the 5,169 console tests
 * passed. The guards are happy. **Only a production build fails**, and on
 * 2026-08-19 that is exactly what happened: an AGL-2153 brand-constant import
 * landed above the directive in
 * `storefront-tax-summary-card.component.tsx`, the gate went green on
 * typecheck + 40 guard steps + 13,957 tests, the batch was promoted, and both
 * `console:build:production` and `tenant:build:production` errored on Vercel
 * after the merge.
 *
 * This guard reads the same thing the bundler reads, so the class cannot
 * survive to a build again. It is deliberately a source sweep rather than a
 * lint rule: it costs milliseconds and needs no ESLint program.
 *
 * See also `feedback_promotion_gate_must_run_tests` — the gate now owes a
 * production BUILD as well as tests and lint.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')

const DIRECTIVES = new Set([
  "'use client'",
  '"use client"',
  "'use server'",
  '"use server"',
])

/** A line that is exactly a React directive, ignoring indentation and `;`. */
function isDirectiveLine(line: string): boolean {
  return DIRECTIVES.has(line.trim().replace(/;$/, ''))
}

/** A line that carries no code — blank, or part of a comment block. */
function isNonCodeLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed === '' ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  )
}

function trackedSourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
}

/** Files whose directive is preceded by real code, with the offending line. */
function misplacedDirectives(files: string[]): string[] {
  const offenders: string[] = []
  for (const file of files) {
    const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split('\n')
    const at = lines.findIndex(isDirectiveLine)
    if (at < 0) continue
    const codeBefore = lines.slice(0, at).find((line) => !isNonCodeLine(line))
    if (codeBefore !== undefined) {
      offenders.push(`${file}:${at + 1} — preceded by: ${codeBefore.trim()}`)
    }
  }
  return offenders
}

describe("a React directive is the first statement in its file (AGL-2153)", () => {
  const files = trackedSourceFiles()

  it('sweeps a population that could contain the defect', () => {
    // Anti-vacuity: if the glob ever stops matching, the assertion below
    // passes over an empty set and proves nothing.
    expect(files.length).toBeGreaterThan(10_000)
    expect(files.filter((f) => f.endsWith('.tsx')).length).toBeGreaterThan(500)
  })

  it('finds a directive that a real file actually declares', () => {
    // Anti-vacuity: proves isDirectiveLine matches the shape in this repo.
    const withDirective = files.filter((file) =>
      readFileSync(join(REPO_ROOT, file), 'utf8').split('\n').some(isDirectiveLine),
    )
    expect(withDirective.length).toBeGreaterThan(100)
  })

  it('has no file whose directive sits below an import', () => {
    expect(misplacedDirectives(files)).toEqual([])
  })

  it('would REPORT a directive pushed below an import', () => {
    // The negative control the sweep above is worthless without: build the
    // exact defect in memory and confirm the detector names it.
    const lines = [
      '/**',
      ' * @license',
      ' */',
      '',
      "import { X } from '@aglyn/aglyn'",
      '',
      "'use client'",
      '',
      "import { Y } from '@aglyn/shared-ui-jsx'",
    ]
    const at = lines.findIndex(isDirectiveLine)
    expect(at).toBe(6)
    expect(lines.slice(0, at).find((line) => !isNonCodeLine(line))).toBe(
      "import { X } from '@aglyn/aglyn'",
    )
  })

  it('accepts a directive that follows only a licence header', () => {
    const lines = [
      '/**',
      ' * @license',
      ' * Copyright 2026 Aglyn LLC',
      ' */',
      '',
      "'use client'",
      '',
      "import { Y } from '@aglyn/shared-ui-jsx'",
    ]
    const at = lines.findIndex(isDirectiveLine)
    expect(lines.slice(0, at).find((line) => !isNonCodeLine(line))).toBeUndefined()
  })
})
