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
 * AGL-1350: no import crosses App Router's two module graphs.
 *
 * The `aglyn/no-cross-graph-import` ESLint rule reports this at the point of
 * failure while you type. This spec asserts the same invariant over the whole
 * workspace in ONE pass, for three reasons the rule cannot cover:
 *
 * 1. `nx lint` runs per project and CI often runs only the affected ones; a
 *    lib module that becomes reachable from a console route is a change to a
 *    file nobody linted.
 * 2. A rule can be turned off, downgraded, or `eslint-disable`d inline. The
 *    invariant took `main` down (AGL-1349) and blocked every production
 *    promotion, so it earns a second, independent assertion — the pattern
 *    `host-enabled-plugins-wiring.spec.ts` and
 *    `collection-delete-cascade.spec.ts` already established here.
 * 3. It fails with the full import trace, which is the thing that actually
 *    tells you where to make the change.
 *
 * The invariant itself is defined once, in
 * `tools/lint-rules/lib/app-router-graph.mjs`, so the rule and this spec
 * cannot drift. It runs in a child process because that analyser is ESM and
 * this suite is transpiled to CommonJS.
 */

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..')
const CHECKER = join(ROOT, 'tools', 'scripts', 'check-app-router-graph.mjs')

interface Violation {
  direction: 'client-into-server' | 'server-into-client'
  file: string
  line: number
  specifier: string
  reachedFrom: string[]
  through: string[]
}

interface Report {
  files: number
  serverEntries: number
  serverModules: number
  clientModules: number
  classification: Record<string, boolean>
  usageMetering: { inServerGraph: boolean; inClientGraph: boolean }
  violations: Violation[]
}

const describeViolation = (violation: Violation) =>
  [
    `${violation.file}:${violation.line} imports '${violation.specifier}'`,
    `  reached from:  ${violation.reachedFrom.join(' -> ')}`,
    `  which reaches: ${violation.through.join(' -> ')}`,
  ].join('\n')

function runChecker(): Report {
  try {
    return JSON.parse(
      execFileSync(process.execPath, [CHECKER, '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      }),
    )
  } catch (error) {
    // Exit 1 means violations, and the payload is still on stdout.
    const stdout = (error as { stdout?: string }).stdout
    if (stdout) return JSON.parse(stdout)
    throw error
  }
}

describe('App Router module graphs stay separated (AGL-1349/1350)', () => {
  const report = runChecker()

  it('walked a graph big enough to be the real one', () => {
    // A resolver regression that silently resolved nothing would make every
    // assertion below pass, so pin the shape of the walk itself.
    expect(report.serverEntries).toBeGreaterThan(100)
    expect(report.serverModules).toBeGreaterThan(1000)
    expect(report.clientModules).toBeGreaterThan(1000)
  })

  it('classifies the two @aglyn/aglyn entry barrels on opposite sides', () => {
    // The premise of AGL-405: one barrel is client-only, the other is
    // server-only, and the modules underneath are safe in either graph.
    expect(report.classification).toEqual({
      clientBarrel: true,
      clientBarrelIsServerOnly: false,
      serverBarrel: true,
      serverBarrelIsClientOnly: false,
      planEntitlementsClientOnly: false,
      planEntitlementsServerOnly: false,
    })
  })

  it('still sees usage-metering.ts in BOTH graphs', () => {
    // The property that made AGL-1349 possible, and the reason that file may
    // import neither barrel. If it ever leaves one graph, the guard is no
    // longer testing what it was written for.
    expect(report.usageMetering).toEqual({
      inServerGraph: true,
      inClientGraph: true,
    })
  })

  it('never pulls a client-only module into a server graph', () => {
    const crossings = report.violations.filter(
      (violation) => violation.direction === 'client-into-server',
    )
    expect(crossings.map(describeViolation)).toEqual([])
  })

  it('never pulls a server-only module into the browser bundle', () => {
    const crossings = report.violations.filter(
      (violation) => violation.direction === 'server-into-client',
    )
    expect(crossings.map(describeViolation)).toEqual([])
  })
})
