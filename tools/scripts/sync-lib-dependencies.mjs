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
 */

// Write what each lib imports into its package.json (AGL-3201).
//
//   npm run sync:lib-dependencies            # write
//   npm run sync:lib-dependencies -- --check # exit 1 if anything would change
//
// Inside this repo an import resolves through a tsconfig alias or the root
// node_modules, so a lib that declares nothing builds and tests green, and
// would install from the registry unable to find what it imports. This reads
// each lib's SHIPPED source and declares it:
//
//   - one of this repo's own libs, at the repo version, the only number it is
//     ever published beside (`release:prepare` moves them together);
//   - anything else at the range the root package.json holds, so a lib never
//     states a version the workspace is not actually running — including what
//     was already declared, which is rewritten to that range;
//   - a package that ships only types by its `@types/` name.
//
// The framework families (react, next, firebase, @mui/*) stay peers; that half
// is `check:lib-boundaries`' and is not written here. Nothing is ever REMOVED:
// `@swc/helpers` is imported by the build's output rather than by the source,
// and a declaration this script cannot see a reason for is not evidence that
// there is none. `check:lib-boundaries` is what refuses a missing one.
//
// Exit codes: 0 in step (or written) · 1 `--check` found drift · 2 a package
// the source imports has no range anywhere in the root package.json.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  declarationsOwed,
  packagesImported,
  readPackageMap,
  typesPackageOf,
  versionedLibPackages,
} from './lib/lib-boundaries.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const check = process.argv.includes('--check')

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const rootRanges = { ...(rootPkg.devDependencies ?? {}), ...(rootPkg.dependencies ?? {}) }
const packageMap = readPackageMap(ROOT)
const workspace = new Set(packageMap.map((project) => project.alias).filter(Boolean))
const versioned = new Set(versionedLibPackages(ROOT).map((entry) => entry.name))

const drifted = []
const unknown = []

for (const project of packageMap) {
  if (project.projectType !== 'library') continue
  const path = join(ROOT, project.root, 'package.json')
  let pkg
  try {
    pkg = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    continue // `check:lib-boundaries` reports a lib with no package.json.
  }
  const owed = declarationsOwed(packagesImported(join(ROOT, project.root), project.alias)).dependencies
  const peers = pkg.peerDependencies ?? {}
  const next = { ...(pkg.dependencies ?? {}) }
  for (const name of owed) {
    if (name in peers) continue
    if (workspace.has(name)) {
      next[name] = rootPkg.version
    } else if (name in rootRanges) {
      next[name] ??= rootRanges[name]
    } else if (typesPackageOf(name) in rootRanges) {
      next[typesPackageOf(name)] ??= rootRanges[typesPackageOf(name)]
    } else if (!(name in next)) {
      unknown.push(`${project.root}: ${name}`)
    }
  }
  // Whatever is already declared is brought into step too, unless this lib
  // keeps a number of its own on the registry: one of our own libs rides the
  // repo version, and a third-party package carries the range the workspace
  // actually runs. That second half is what caught every lib declaring
  // `@swc/helpers ~0.3.3` — a generator default from years ago — while the
  // compiled output imports a path that only exists from 0.5.
  if (versioned.has(project.name)) {
    for (const name of Object.keys(next)) {
      if (workspace.has(name)) next[name] = rootPkg.version
      else if (name in rootRanges) next[name] = rootRanges[name]
    }
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
  if (JSON.stringify(sorted) === JSON.stringify(pkg.dependencies ?? {})) continue
  drifted.push(project.root)
  if (check) continue
  // `dependencies` sits where it already is, or directly before the peers.
  const out = {}
  let placed = false
  for (const [key, value] of Object.entries(pkg)) {
    if (key === 'dependencies') {
      out.dependencies = sorted
      placed = true
    } else {
      if (key === 'peerDependencies' && !placed) {
        out.dependencies = sorted
        placed = true
      }
      out[key] = value
    }
  }
  if (!placed) out.dependencies = sorted
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`)
}

if (unknown.length) {
  console.error('sync:lib-dependencies: imported by shipped source, with no range in the root package.json:')
  for (const line of unknown) console.error(`  ${line}`)
  process.exit(2)
}
if (check && drifted.length) {
  console.error(
    `sync:lib-dependencies: ${drifted.length} lib package.json file(s) do not declare what their source imports:\n` +
      drifted.map((root) => `  ${root}/package.json`).join('\n') +
      '\n\nRun `npm run sync:lib-dependencies` and commit the result.',
  )
  process.exit(1)
}
console.log(
  check
    ? 'sync:lib-dependencies: every lib declares what its shipped source imports'
    : `sync:lib-dependencies: wrote ${drifted.length} lib package.json file(s)`,
)
