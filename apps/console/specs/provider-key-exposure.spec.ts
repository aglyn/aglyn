/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * AGL-2240: no model-provider API key is reachable from the browser bundle.
 *
 * Aglyn Assist's first architectural constraint is that the Anthropic key
 * lives on the server and the console talks to a proxy route. That is how
 * both entrypoints are written. This is what keeps it true after the people
 * who wrote them have moved on.
 *
 * ## Why the subprocessor gate does not already cover this
 *
 * `assist-anthropic-subprocessor-gate.spec.ts` enumerates every file that
 * NAMES `ANTHROPIC_API_KEY` and is the right guard for its own question — a
 * new name is a new Anthropic data flow, and someone has to check the
 * published subprocessor page before it ships. It is an allowlist over a
 * FILE SET, and a file set is exactly what does not change when
 * `route.ts` is refactored into a module that a `'use client'` component
 * imports. That suite stays green while the key compiles into JavaScript
 * served to every visitor.
 *
 * The question here is which MODULE GRAPH the reader is in, and
 * `tools/lint-rules/lib/app-router-graph.mjs` already computes both closures
 * for AGL-1349/1350. The invariant is a set lookup, which is why it is worth
 * having: it is cheap, and the failure it prevents is a key rotation plus
 * whatever was billed against it first.
 *
 * ## The walk is asserted before the verdict is
 *
 * A resolver that silently resolved nothing would report an empty client
 * graph and pass every assertion below — the "green check only proves what
 * it reads" failure, in its purest form. So the suite pins the size of the
 * walk AND pins that the two real key readers were actually FOUND and
 * classified, before it asserts that none is exposed. A guard that cannot
 * see the files it guards is not a guard.
 *
 * Runs the analyser in a child process because it is ESM and this suite is
 * transpiled to CommonJS — the same arrangement `app-router-graph.spec.ts`
 * uses.
 */

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..')
const CHECKER = join(ROOT, 'tools', 'scripts', 'check-provider-key-exposure.mjs')

interface Reader {
  file: string
  keys: string[]
  useClient: boolean
  inClientGraph: boolean
  inServerGraph: boolean
  publicPrefixed: string[]
}

interface Report {
  files: number
  clientModules: number
  serverModules: number
  readers: Reader[]
  exposed: Reader[]
}

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
    // Exit 1 means exposures, and the payload is still on stdout.
    const stdout = (error as { stdout?: string }).stdout
    if (stdout) return JSON.parse(stdout)
    throw error
  }
}

const describeExposure = (reader: Reader) =>
  `${reader.file} reads ${reader.keys.join(', ')}` +
  (reader.publicPrefixed.length
    ? ` — NEXT_PUBLIC_ prefixed (${reader.publicPrefixed.join(', ')}), inlined into the browser bundle by definition`
    : '') +
  (reader.useClient ? " — declares 'use client'" : '') +
  (reader.inClientGraph ? ' — reachable from the client module graph' : '')

describe('no provider key reaches the browser (AGL-2240)', () => {
  const report = runChecker()

  it('walked a graph big enough to be the real one', () => {
    // Pinned first, because every assertion after it is satisfied by a walk
    // that found nothing at all.
    expect(report.files).toBeGreaterThan(10000)
    expect(report.clientModules).toBeGreaterThan(1000)
    expect(report.serverModules).toBeGreaterThan(1000)
  })

  it('found the two real Anthropic readers and put both in the SERVER graph', () => {
    // The positive control. Without it, a regex that stopped matching
    // `process.env.ANTHROPIC_API_KEY` would report zero readers and zero
    // exposures — a passing suite that is watching nothing.
    const byFile = new Map(report.readers.map((reader) => [reader.file, reader]))
    for (const path of [
      'apps/console/app/api/assist/chat/route.ts',
      'libs/plugins/marketplace/src/lib/server/ai-assist.ts',
    ]) {
      const reader = byFile.get(path)
      expect([path, reader?.keys]).toEqual([path, ['ANTHROPIC_API_KEY']])
      expect([path, reader?.inServerGraph]).toEqual([path, true])
      expect([path, reader?.inClientGraph]).toEqual([path, false])
    }
  })

  it('has no provider key in the client graph, and none NEXT_PUBLIC_ prefixed', () => {
    // The invariant. Two distinct ways to publish a key, one verdict: a
    // client-graph module ships its source, and the NEXT_PUBLIC_ prefix
    // ships the VALUE from wherever it is read — including a server module,
    // which is why the prefix is disqualifying on its own.
    expect(report.exposed.map(describeExposure)).toEqual([])
  })

  it('says which key names it would catch, so a new provider is not a new blind spot', () => {
    // The pattern is broader than what Aglyn ships today. Pinning that here
    // is what stops a later narrowing to `ANTHROPIC_API_KEY` — which would
    // read as a tidy-up and would silently stop guarding the next provider
    // anybody wires in.
    const source = require('node:fs').readFileSync(CHECKER, 'utf8') as string
    const pattern = /const PROVIDER_KEY = (\/.+\/)\n/.exec(source)?.[1]
    expect(pattern).toBeTruthy()
    const matcher = new RegExp(
      pattern!.slice(1, pattern!.lastIndexOf('/')),
      pattern!.slice(pattern!.lastIndexOf('/') + 1),
    )
    for (const name of [
      'ANTHROPIC_API_KEY',
      'NEXT_PUBLIC_ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'CLAUDE_TOKEN',
      'GEMINI_API_SECRET',
    ]) {
      expect([name, matcher.test(name)]).toEqual([name, true])
    }
    // And it does not match the ordinary configuration around them, which is
    // what would make the guard noisy enough to be turned off.
    for (const name of [
      'ASSIST_MODEL',
      'ASSIST_FREE_DAILY_LIMIT',
      'NEXT_PUBLIC_DOCS_ORIGIN',
      'FIREBASE_PRIVATE_KEY',
    ]) {
      expect([name, matcher.test(name)]).toEqual([name, false])
    }
  })
})
