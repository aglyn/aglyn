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
 * The shared contracts for the native apps (docs/mobile/native-architecture.md §5).
 *
 *   node tools/scripts/generate-native-contracts.mjs           # write
 *   node tools/scripts/generate-native-contracts.mjs --check   # drift guard
 *
 * Reads tools/scripts/native-contracts.json. Types come from the TypeScript
 * compiler (./lib/native-contracts.mjs), values from the modules themselves
 * through jiti, and both only from modules on mobile-pure-modules.json. The
 * list-query cases run the console's own `planListQuery` over representative
 * requests, so each platform's port of the planner replays them.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildContractModel,
  CONTRACTS_JSON_FILE,
  contractsJsonContent,
  KOTLIN_CONTRACTS_FILE,
  kotlinContractsContent,
  LIST_QUERY_CASES_FILE,
  plainValue,
  SWIFT_CONTRACTS_FILE,
  swiftContractsContent,
} from './lib/native-contracts.mjs'
import { listQueryCases, listQueryCasesContent, NORMALIZER_SAMPLES } from './lib/native-list-query-cases.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = 'tools/scripts/native-contracts.json'
const PURE = 'tools/scripts/mobile-pure-modules.json'
const PLANNER = 'libs/shared/util/tools/src/lib/list-query/list-query-plan.ts'
const FILTER = 'libs/shared/util/tools/src/lib/list-query/list-filter.ts'
const NAME_SEARCH = 'libs/aglyn/src/lib/app-utils/name-search.ts'

// The planner bounds a day in local time; the cases are recorded in UTC and
// say so, and each port replays them in that zone.
process.env.TZ = 'UTC'

const require = createRequire(join(ROOT, 'package.json'))
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

function typeModel(config, pure) {
  const ts = require('typescript')
  const base = readJson('tsconfig.base.json').compilerOptions
  const { options, errors } = ts.convertCompilerOptionsFromJson(
    { ...base, strictNullChecks: true, noEmit: true, skipLibCheck: true, types: [] },
    ROOT,
  )
  if (errors.length) throw new Error(errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'))
  const program = ts.createProgram({
    rootNames: Object.keys(config.modules).map((module) => join(ROOT, module)),
    options: { ...options, baseUrl: ROOT },
  })
  return buildContractModel({ ts, program, root: ROOT, config, pure })
}

/**
 * The tsconfig path aliases as jiti prefixes. jiti matches a prefix, so a
 * package's `/*` entry maps its directory and stands for the package; a bare
 * entry with a `/*` twin is dropped, since the pure modules import a file,
 * never a barrel.
 */
function workspaceAliases(paths) {
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    if (key.endsWith('/*')) alias[key.slice(0, -2)] = join(ROOT, target.replace(/\/\*$/, ''))
    else if (!(`${key}/*` in paths)) alias[key] = join(ROOT, target)
  }
  return alias
}

async function main() {
  const config = readJson(CONFIG)
  const pure = new Set(readJson(PURE).modules.map((entry) => entry.path))
  const model = typeModel(config, pure)

  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), {
    interopDefault: true,
    fsCache: false,
    alias: workspaceAliases(readJson('tsconfig.base.json').compilerOptions.paths),
  })
  const load = (module) => jiti.import(join(ROOT, module))

  const values = {}
  for (const { module, name } of model.values) {
    const loaded = await load(module)
    values[name] = plainValue(loaded[name], name)
  }

  for (const module of [PLANNER, FILTER, NAME_SEARCH]) {
    if (!pure.has(module)) throw new Error(`${module} is not on ${PURE}`)
  }
  const planner = await load(PLANNER)
  const filter = await load(FILTER)
  const nameSearch = await load(NAME_SEARCH)
  const declarations = {}
  for (const [name, { base }] of Object.entries(config.listQueryCases)) {
    const module = model.values.find((v) => v.name === name)?.module
    if (!module) throw new Error(`listQueryCases names ${name}, which no module's values list`)
    if (base && !(base in values)) throw new Error(`listQueryCases.${name}.base names ${base}, which no module's values list`)
    declarations[name] = { declaration: values[name], base: base ? values[base] : undefined }
  }
  const cases = listQueryCases({
    declarations,
    plan: (declaration, request) => planner.planListQuery(declaration, request, nameSearch.nameSearchNormalizers),
    operators: filter.listFilterOperators,
  })
  const normalizers = NORMALIZER_SAMPLES.map((input) => ({
    input,
    key: nameSearch.nameSearchKey(input),
    token: nameSearch.nameSearchToken(input),
    reversed: nameSearch.nameSearchReversed(input),
    tokens: nameSearch.nameSearchTokens(input),
  }))

  const outputs = [
    { file: CONTRACTS_JSON_FILE, content: contractsJsonContent(values) },
    { file: SWIFT_CONTRACTS_FILE, content: swiftContractsContent(model) },
    { file: KOTLIN_CONTRACTS_FILE, content: kotlinContractsContent(model) },
    { file: LIST_QUERY_CASES_FILE, content: listQueryCasesContent({ cases, normalizers }) },
  ]

  if (process.argv.includes('--check')) {
    const drifted = outputs.filter(({ file, content }) => {
      try {
        return readFileSync(join(ROOT, file), 'utf8') !== content
      } catch {
        return true // Absent is drift.
      }
    })
    if (drifted.length) {
      console.error(
        `${drifted.map(({ file }) => file).join('\n')}\nno longer match ${CONFIG} and the modules it names.\n` +
          'They are generated. Run: node tools/scripts/generate-native-contracts.mjs',
      )
      process.exit(1)
    }
    for (const { file } of outputs) console.log(`ok ${file}`)
    return
  }
  for (const { file, content } of outputs) {
    mkdirSync(dirname(join(ROOT, file)), { recursive: true })
    writeFileSync(join(ROOT, file), content)
    console.log(`wrote ${file}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
