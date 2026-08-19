#!/usr/bin/env node
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
 * No model-provider API key can reach the browser bundle (AGL-2240).
 *
 * ```
 * npm run check:provider-key-exposure
 * node tools/scripts/check-provider-key-exposure.mjs --json
 * ```
 *
 * Workstream F's first constraint is that Aglyn Assist talks to Anthropic
 * through a server-side proxy and the key never goes client-side. Both
 * entrypoints are written that way today. This is what keeps them that way.
 *
 * ## Why this is not the subprocessor gate
 *
 * `apps/console/specs/assist-anthropic-subprocessor-gate.spec.ts` already
 * enumerates every file that NAMES `ANTHROPIC_API_KEY`, and it is the right
 * guard for the question it asks: a new name is a new Anthropic data flow,
 * and someone must check the published subprocessor page before it ships.
 *
 * It cannot answer this one. An allowlisted reader that gains a `'use
 * client'` directive — or that gets imported by a module which has one —
 * leaves the file set completely unchanged, so that suite stays green while
 * the key is being compiled into JavaScript served to every visitor. The
 * question here is not *which files*, it is *which graph*.
 *
 * ## The two ways a key ships to a browser
 *
 * 1. **The module lands in the client closure.** Next compiles a `'use
 *    client'` module and everything it reaches into the browser bundle.
 *    `process.env.X` in that bundle is inlined at build time for whatever
 *    the bundler can see, and the code itself is public regardless.
 *    `tools/lint-rules/lib/app-router-graph.mjs` already computes that
 *    closure for AGL-1349/1350, so membership is a set lookup.
 *
 * 2. **The `NEXT_PUBLIC_` prefix.** This one needs no import at all: the
 *    prefix is a standing instruction to Next to inline the VALUE into the
 *    client bundle, and it does so wherever the var is read, including from
 *    a server module. A provider key under that prefix is published by
 *    definition, so the name alone is the violation — which is why it is
 *    checked separately and cannot be excused by an allowlist entry.
 *
 * ## What counts as a read
 *
 * A `process.env.<NAME>` / `process.env['<NAME>']` reference, not a mention.
 * Runbooks, env templates and the legal snapshot name these keys constantly
 * and none of them is a data flow — the subprocessor gate is where a mention
 * gets classified. Here, prose is noise and only a read is evidence.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { analyzeAppRouterGraph } from '../lint-rules/lib/app-router-graph.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const asJson = process.argv.includes('--json')

/**
 * Env vars naming a model-provider credential. Matched on the NAME, so a
 * future provider is covered the day someone adds its key rather than the
 * day someone remembers this file: `ANTHROPIC_API_KEY`,
 * `OPENAI_API_KEY`, `NEXT_PUBLIC_ANTHROPIC_KEY` and
 * `MY_CLAUDE_TOKEN` all match.
 *
 * Deliberately broader than what Aglyn ships. The guard is cheap when it
 * matches nothing, and the failure it prevents is unrecoverable: a key in a
 * public bundle is a key that must be rotated, and every request billed
 * against it in the meantime is ours to pay.
 */
const PROVIDER_KEY = /\b[A-Z0-9_]*(ANTHROPIC|OPENAI|CLAUDE|GEMINI|MISTRAL)[A-Z0-9_]*(KEY|TOKEN|SECRET)\b/

/** `process.env.NAME` and `process.env['NAME']` — a read, not a mention. */
const ENV_READ = /process\s*\.\s*env\s*(?:\.\s*([A-Z0-9_]+)|\[\s*['"`]([A-Z0-9_]+)['"`]\s*\])/g

/** Tracked source files, build output excluded. */
function trackedFiles() {
  return execFileSync('git', ['ls-files'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((path) => !path.includes('/build/') && !path.includes('/.next/'))
    .filter((path) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path))
}

/** Every provider-key env var this file READS, deduped. */
function providerKeyReads(source) {
  const names = new Set()
  for (const match of source.matchAll(ENV_READ)) {
    const name = match[1] ?? match[2]
    if (name && PROVIDER_KEY.test(name)) names.add(name)
  }
  return [...names]
}

const graph = analyzeAppRouterGraph(ROOT)

const readers = []
for (const path of trackedFiles()) {
  let source
  try {
    source = readFileSync(join(ROOT, path), 'utf8')
  } catch {
    continue
  }
  const keys = providerKeyReads(source)
  if (!keys.length) continue
  const absolute = join(ROOT, path)
  readers.push({
    file: path,
    keys,
    // `useClient` is the directive on the file itself; `inClientGraph` is
    // the transitive answer — a plain module pulled in by a client one is
    // just as published as the client one.
    useClient: /^\s*(['"])use client\1/m.test(source),
    inClientGraph: graph.clientModules.has(absolute),
    inServerGraph:
      graph.serverModules.has(absolute) || graph.serverEntries.has(absolute),
    // The prefix is the violation on its own — no import required.
    publicPrefixed: keys.filter((key) => key.startsWith('NEXT_PUBLIC_')),
  })
}

const exposed = readers.filter(
  (reader) =>
    reader.inClientGraph || reader.useClient || reader.publicPrefixed.length,
)

if (asJson) {
  process.stdout.write(
    JSON.stringify({
      files: graph.files.length,
      clientModules: graph.clientModules.size,
      serverModules: graph.serverModules.size,
      readers,
      exposed,
    }),
  )
  process.exit(exposed.length === 0 ? 0 : 1)
}

console.log(
  `Walked ${graph.files.length} modules (${graph.serverModules.size} server / ` +
    `${graph.clientModules.size} client). ${readers.length} file(s) read a ` +
    'model-provider key.',
)
for (const reader of readers) {
  console.log(
    `  ${reader.inClientGraph || reader.useClient ? 'CLIENT' : 'server'}  ` +
      `${reader.file}  [${reader.keys.join(', ')}]`,
  )
}

if (exposed.length === 0) {
  console.log('No provider key is reachable from the browser bundle.')
  process.exit(0)
}

for (const reader of exposed) {
  console.error('')
  if (reader.publicPrefixed.length) {
    console.error(
      `${reader.file} reads ${reader.publicPrefixed.join(', ')} — the ` +
        'NEXT_PUBLIC_ prefix inlines the VALUE into the browser bundle. A ' +
        'provider key under that prefix is published, wherever it is read.',
    )
  }
  if (reader.inClientGraph || reader.useClient) {
    console.error(
      `${reader.file} reads ${reader.keys.join(', ')} and is in the CLIENT ` +
        `module graph${reader.useClient ? " (it declares 'use client')" : ''}. ` +
        'Move the read behind a server route and call that route instead.',
    )
  }
}
console.error('')
console.error(
  `${exposed.length} provider key exposure(s). Aglyn Assist reaches Anthropic ` +
    'through a server proxy precisely so the key never ships — AGL-2240.',
)
process.exit(1)
