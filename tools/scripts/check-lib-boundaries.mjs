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
// The package map, held as an exit code (AGL-2941).
//
//   npm run check:lib-boundaries
//   npm run check:lib-boundaries -- --graph <file>   # an nx graph JSON already on disk
//
// Four things, all from one `nx graph --file` and the tracked tree:
//
//  1. Every static project edge satisfies `DEP_CONSTRAINTS`, or is a row of
//     `lib-boundaries-allowlist.json`. A new edge is red; so is a row the
//     graph no longer has, because a list that only grows is not a ratchet.
//  2. `docs/PACKAGES.md` has a row for every project the graph knows.
//  3. Every lib `package.json` carries its npm name, the repo version, an
//     `exports` map for its entry points and a peer for every framework its
//     shipped source imports.
//  4. Every allowlisted source project's own `eslint.config.mjs` spreads
//     `boundaryOverridesFor(import.meta.url)`: ESLint resolves `files`
//     patterns against the directory of the config it loaded, so the
//     lint-side override can only come from the project's own config, and
//     one that lacks it lints red on an edge the map carries.
//
// The lint rule sees the same map at every file; this sees it at the project
// level, so an edge that reached `main` through a disabled line is still
// refused here.
//
// EXIT CODES: 0 clean, 1 a finding, 2 could not check (no graph, no doc).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEP_CONSTRAINTS,
  OVERRIDES_CALL,
  compareToAllowlist,
  evaluateEdges,
  missingMapRows,
  overrideWiring,
  packageFindings,
  peerFamiliesImported,
  readPackageMap,
} from './lib/lib-boundaries.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const ALLOWLIST_PATH = join(HERE, 'lib-boundaries-allowlist.json')
const DOC_PATH = join(REPO_ROOT, 'docs', 'PACKAGES.md')

function graphFrom(argv) {
  const at = argv.indexOf('--graph')
  if (at >= 0) {
    const file = argv[at + 1]
    if (!file || !existsSync(file)) {
      console.error(`--graph needs the path of an nx graph JSON; ${file ?? '(nothing)'} is not one`)
      process.exit(2)
    }
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  const dir = mkdtempSync(join(tmpdir(), 'aglyn-lib-boundaries-'))
  const file = join(dir, 'graph.json')
  try {
    execFileSync(join(REPO_ROOT, 'node_modules', '.bin', 'nx'), ['graph', '--file', file], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NX_DAEMON: 'false' },
    })
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`could not read the project graph: ${error.message.split('\n')[0]}`)
    process.exit(2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const document = graphFrom(process.argv.slice(2))
const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).edges
if (!existsSync(DOC_PATH)) {
  console.error(`${DOC_PATH} is missing; the package map has no prose half to compare against`)
  process.exit(2)
}

const problems = []

// 1. The edges.
const verdict = compareToAllowlist(evaluateEdges(document, DEP_CONSTRAINTS), allowlist)
for (const edge of verdict.regressions) {
  problems.push(
    `${edge.from} -> ${edge.to} breaks the map: ${edge.rule}.\n` +
      `    Put what is shared behind a core seam (docs/PACKAGES.md, "Rules"). Down a layer only if it ` +
      `carries no plugin's domain: libs/shared is generic, types included, so it is not a home for a model two plugins agree on. ` +
      `A new row in tools/scripts/lib-boundaries-allowlist.json is not the fix: the list only shrinks.`,
  )
}
for (const edge of verdict.stale) {
  problems.push(
    `${edge.from} -> ${edge.to} is allowlisted but the graph no longer has it, or no rule refuses it.\n` +
      `    Remove its row from tools/scripts/lib-boundaries-allowlist.json (and its line in docs/PACKAGES.md).`,
  )
}

// 2. The doc.
const projectNames = Object.keys(document.graph.nodes)
for (const name of missingMapRows(readFileSync(DOC_PATH, 'utf8'), projectNames)) {
  problems.push(`docs/PACKAGES.md has no row for \`${name}\`: every project gets its map row in the commit that adds it.`)
}

// 3. The lint-side wiring.
const packageMap = readPackageMap(REPO_ROOT)
for (const source of overrideWiring(allowlist, packageMap, (path) => (existsSync(join(REPO_ROOT, path)) ? readFileSync(join(REPO_ROOT, path), 'utf8') : null))) {
  if (source.wired) continue
  problems.push(
    `${source.config} does not spread the allowlist overrides, so ${source.name} lints red on an edge the map carries.\n` +
      `    Import { ${OVERRIDES_CALL.split('(')[0]} } beside baseConfig and spread \`...${OVERRIDES_CALL},\` after \`...baseConfig,\`.`,
  )
}

// 4. The packages.
const rootVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version
for (const project of packageMap) {
  const root = join(REPO_ROOT, project.root)
  if (project.projectType !== 'library') continue
  const packagePath = join(root, 'package.json')
  if (!existsSync(packagePath)) {
    problems.push(`${project.root} has no package.json; a lib is a package and states its name.`)
    continue
  }
  const findings = packageFindings({
    project,
    pkg: JSON.parse(readFileSync(packagePath, 'utf8')),
    rootVersion,
    peers: peerFamiliesImported(root),
    hasServerEntry: existsSync(join(root, 'src', 'server.ts')),
  })
  for (const finding of findings) problems.push(`${project.root}/package.json: ${finding}`)
}

const edgeCount = Object.values(document.graph.dependencies).flat().filter((edge) => edge.type === 'static' && !edge.target.startsWith('npm:')).length
if (problems.length) {
  console.error(`check:lib-boundaries: ${problems.length} finding(s) over ${projectNames.length} projects, ${edgeCount} static edges\n`)
  for (const problem of problems) console.error(`  ${problem}\n`)
  process.exit(1)
}
console.log(
  `check:lib-boundaries: ${projectNames.length} projects, ${edgeCount} static edges, ` +
    `${allowlist.length} allowlisted (all still real), every project in docs/PACKAGES.md, ` +
    `${packageMap.filter((project) => project.projectType === 'library').length} lib package.json files in shape`,
)
