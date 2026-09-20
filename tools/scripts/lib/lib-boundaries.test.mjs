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
// The package-map guard's forced reds (AGL-2941). Each fixture is the shape
// the guard exists to refuse, so a guard that stopped seeing it fails here
// before it renders green on `main`.
//
//   npm run test:lib-boundaries

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  DEP_CONSTRAINTS,
  INDEPENDENTLY_VERSIONED,
  OVERRIDES_CALL,
  compareToAllowlist,
  declarationsOwed,
  evaluateEdges,
  lintOverridesFor,
  missingMapRows,
  overrideWiring,
  packageFindings,
  sideEffectsFindings,
  packageOfSpecifier,
  packagesImported,
  peerFamiliesImported,
  readPackageMap,
  typesPackageOf,
  versionedLibPackages,
} from './lib-boundaries.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** A graph with the tags the real projects carry, and the edges the test names. */
function graph(edges) {
  const tags = {
    aglyn: ['scope:lib', 'scope:aglyn', 'scope:data', 'scope:feature', 'aglyn:framework', 'scope:core', 'type:data', 'type:feature'],
    'shared-util-tools': ['scope:lib', 'scope:shared', 'scope:util', 'type:util'],
    'besigner-core': ['scope:lib', 'scope:aglyn', 'scope:data', 'scope:feature', 'aglyn:besigner', 'scope:besigner', 'type:data', 'type:feature'],
    'besigner-feature-designer': ['scope:lib', 'scope:aglyn', 'scope:feature', 'aglyn:besigner', 'scope:besigner-ui', 'type:feature'],
    'tenant-runtime': ['scope:lib', 'scope:aglyn', 'aglyn:tenancy', 'scope:tenant', 'scope:feature', 'type:feature'],
    'plugins-crm': ['aglyn:addons', 'scope:plugin', 'type:feature'],
    'plugins-forms': ['aglyn:addons', 'scope:plugin', 'type:feature'],
    console: ['scope:app', 'scope:private', 'scope:console'],
  }
  const nodes = Object.fromEntries(Object.entries(tags).map(([name, list]) => [name, { type: 'lib', data: { tags: list } }]))
  const dependencies = Object.fromEntries(Object.keys(tags).map((name) => [name, []]))
  for (const [from, to, type = 'static'] of edges) dependencies[from].push({ source: from, target: to, type })
  return { graph: { nodes, dependencies } }
}

const pairs = (violations) => [...new Set(violations.map((edge) => `${edge.from} -> ${edge.to}`))]

describe('evaluateEdges', () => {
  it('is RED when the core imports a plugin (the edge the map exists to refuse)', () => {
    const violations = evaluateEdges(graph([['aglyn', 'plugins-crm']]), DEP_CONSTRAINTS)
    assert.deepEqual(pairs(violations), ['aglyn -> plugins-crm'])
    assert.ok(violations.some((edge) => edge.rule.startsWith('scope:core may only depend on')), violations.map((edge) => edge.rule).join('; '))
  })

  it('is RED when a plugin imports another plugin, and when it imports the designer UI', () => {
    assert.deepEqual(pairs(evaluateEdges(graph([['plugins-forms', 'plugins-crm']]))), ['plugins-forms -> plugins-crm'])
    assert.deepEqual(pairs(evaluateEdges(graph([['plugins-crm', 'besigner-feature-designer']]))), [
      'plugins-crm -> besigner-feature-designer',
    ])
  })

  it('is RED when shared reaches up, and when the designer logic reaches its own UI', () => {
    assert.deepEqual(pairs(evaluateEdges(graph([['shared-util-tools', 'aglyn']]))), ['shared-util-tools -> aglyn'])
    assert.deepEqual(pairs(evaluateEdges(graph([['besigner-core', 'besigner-feature-designer']]))), [
      'besigner-core -> besigner-feature-designer',
    ])
  })

  it('is GREEN for the layering the map allows', () => {
    const allowed = [
      ['aglyn', 'shared-util-tools'],
      ['besigner-core', 'aglyn'],
      ['besigner-feature-designer', 'besigner-core'],
      ['tenant-runtime', 'aglyn'],
      ['plugins-crm', 'tenant-runtime'],
      ['plugins-crm', 'besigner-core'],
      ['console', 'besigner-feature-designer'],
      ['console', 'tenant-runtime'],
    ]
    assert.deepEqual(evaluateEdges(graph(allowed)), [])
  })

  it('judges static edges only: the loader manifests reach plugins dynamically on purpose', () => {
    assert.deepEqual(evaluateEdges(graph([['console', 'plugins-crm', 'dynamic']])), [])
    assert.deepEqual(pairs(evaluateEdges(graph([['console', 'plugins-crm']]))), ['console -> plugins-crm'])
  })
})

describe('compareToAllowlist', () => {
  const violations = evaluateEdges(graph([['plugins-forms', 'plugins-crm'], ['aglyn', 'plugins-crm']]))

  it('keeps a listed edge green and refuses the unlisted one', () => {
    const verdict = compareToAllowlist(violations, [{ from: 'plugins-forms', to: 'plugins-crm' }])
    assert.equal(verdict.clean, false)
    assert.deepEqual(pairs(verdict.regressions), ['aglyn -> plugins-crm'])
    assert.deepEqual(verdict.stale, [])
  })

  it('is RED for a row the graph no longer has: the list only shrinks', () => {
    const verdict = compareToAllowlist(violations, [
      { from: 'plugins-forms', to: 'plugins-crm' },
      { from: 'aglyn', to: 'plugins-crm' },
      { from: 'plugins-crm', to: 'plugins-forms' },
    ])
    assert.deepEqual(pairs(verdict.stale), ['plugins-crm -> plugins-forms'])
    assert.equal(verdict.clean, false)
  })

  it('is clean when the list is exactly the graph', () => {
    const verdict = compareToAllowlist(violations, [
      { from: 'plugins-forms', to: 'plugins-crm' },
      { from: 'aglyn', to: 'plugins-crm' },
    ])
    assert.equal(verdict.clean, true)
  })
})

describe('lintOverridesFor', () => {
  const packageMap = [
    { name: 'plugins-forms', root: 'libs/plugins/forms', alias: '@aglyn/plugins-forms', deepAlias: true, tags: [], projectType: 'library' },
    { name: 'plugins-crm', root: 'libs/plugins/crm', alias: '@aglyn/plugins-crm', deepAlias: true, tags: [], projectType: 'library' },
    { name: 'shared-util-email', root: 'libs/shared/util/email', alias: '@aglyn/shared-util-email', deepAlias: true, tags: [], projectType: 'library' },
    { name: 'aglyn', root: 'libs/aglyn', alias: '@aglyn/aglyn', deepAlias: true, tags: [], projectType: 'library' },
  ]

  const allowlist = [
    { from: 'plugins-forms', to: 'plugins-crm' },
    { from: 'shared-util-email', to: 'aglyn', enforcedInline: true },
  ]

  it('gives the asking project one block over its own files with the target alias allowed, bare and deep', () => {
    const blocks = lintOverridesFor({ allowlist, packageMap, projectRoot: 'libs/plugins/forms', ruleName: 'rule', baseOptions: { allow: [], depConstraints: [] } })
    assert.equal(blocks.length, 1)
    assert.deepEqual(blocks[0].files, ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'])
    const [, options] = blocks[0].rules.rule
    assert.deepEqual(options.depConstraints, [])
    const [pattern] = options.allow
    assert.match('@aglyn/plugins-crm', new RegExp(pattern))
    assert.match('@aglyn/plugins-crm/model/crm-routes', new RegExp(pattern))
    assert.doesNotMatch('@aglyn/plugins-crm-extra', new RegExp(pattern))
    assert.doesNotMatch('@aglyn/plugins-forms', new RegExp(pattern))
  })

  it('gives a project with no row nothing, so the alias stays refused there', () => {
    assert.deepEqual(lintOverridesFor({ allowlist, packageMap, projectRoot: 'libs/plugins/crm', ruleName: 'rule', baseOptions: {} }), [])
  })

  it('emits nothing for an edge the one importer already disables inline', () => {
    assert.deepEqual(lintOverridesFor({ allowlist, packageMap, projectRoot: 'libs/shared/util/email', ruleName: 'rule', baseOptions: {} }), [])
  })

  it('names the source config that does not spread the overrides', () => {
    const texts = { 'libs/plugins/forms/eslint.config.mjs': `export default [...baseConfig, ...${OVERRIDES_CALL}]` }
    const wiring = overrideWiring(allowlist, packageMap, (path) => texts[path] ?? null)
    assert.deepEqual(wiring, [{ name: 'plugins-forms', config: 'libs/plugins/forms/eslint.config.mjs', wired: true }])
    const unwired = overrideWiring([{ from: 'plugins-crm', to: 'plugins-forms' }], packageMap, () => 'export default [...baseConfig]')
    assert.deepEqual(unwired, [{ name: 'plugins-crm', config: 'libs/plugins/crm/eslint.config.mjs', wired: false }])
  })
})

describe('missingMapRows', () => {
  it('names every project the table has no backticked cell for', () => {
    const doc = '# Map\n\n| project | npm |\n| -- | -- |\n| `aglyn` | `@aglyn/aglyn` |\n\nProse mentioning `plugins-crm` is not a row.\n'
    assert.deepEqual(missingMapRows(doc, ['aglyn', 'plugins-crm', 'console']), ['console', 'plugins-crm'])
  })
})

describe('packageFindings', () => {
  const project = { name: 'plugins-crm', root: 'libs/plugins/crm', alias: '@aglyn/plugins-crm', deepAlias: true }
  const good = {
    name: '@aglyn/plugins-crm',
    version: '1.0.0',
    exports: { '.': {}, './*': {} },
    peerDependencies: { react: '^19', '@mui/material': '^9' },
    sideEffects: false,
    license: 'Apache-2.0',
    publishConfig: { access: 'public', provenance: true },
    repository: { type: 'git', url: 'https://github.com/aglyn/aglyn.git', directory: 'libs/plugins/crm' },
  }

  it('is clean for a package in the shape the map asks for', () => {
    assert.deepEqual(packageFindings({ project, pkg: good, rootVersion: '1.0.0', peers: ['@mui/material', 'react'], hasServerEntry: false }), [])
  })

  it('names the version, the missing entry points, the missing peer and the bundled framework', () => {
    const bad = { name: '@aglyn/plugins-crm', version: '0.0.1', exports: { '.': {} }, dependencies: { react: '^19' }, sideEffects: false }
    const findings = packageFindings({ project, pkg: bad, rootVersion: '1.0.0', peers: ['react'], hasServerEntry: true })
    assert.ok(findings.some((line) => line.includes('version is "0.0.1"')), findings.join('\n'))
    assert.ok(findings.some((line) => line.includes('"./server"')), findings.join('\n'))
    assert.ok(findings.some((line) => line.includes('"./*"')), findings.join('\n'))
    assert.ok(findings.some((line) => line.includes('peerDependencies lacks react')), findings.join('\n'))
    assert.ok(findings.some((line) => line.includes('dependencies carries react')), findings.join('\n'))
  })

  it('lets an independently versioned lib keep its registry number', () => {
    const cli = { name: 'cli', root: 'libs/cli', alias: '@aglyn/cli', deepAlias: false }
    assert.ok(INDEPENDENTLY_VERSIONED.has('cli'))
    const findings = packageFindings({ project: cli, pkg: { ...good, name: '@aglyn/cli', version: '0.1.2' }, rootVersion: '1.0.0', peers: [], hasServerEntry: false })
    assert.deepEqual(findings, [])
  })
})

describe('peerFamiliesImported', () => {
  it('reads shipped source only and folds subpaths into their package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aglyn-peers-'))
    try {
      mkdirSync(join(dir, 'src', 'lib'), { recursive: true })
      writeFileSync(join(dir, 'src', 'lib', 'a.tsx'), "import { useState } from 'react'\nimport Box from '@mui/material/Box'\nimport { doc } from 'firebase/firestore'\nimport { z } from 'zod'\n")
      writeFileSync(join(dir, 'src', 'lib', 'a.spec.tsx'), "import { render } from 'react-dom'\n")
      assert.deepEqual(peerFamiliesImported(dir), ['@mui/material', 'firebase', 'react'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('what a lib must declare (AGL-3201)', () => {
  it('folds a specifier into its package, and knows what is not one', () => {
    assert.equal(packageOfSpecifier('@aglyn/aglyn/app-utils/crm'), '@aglyn/aglyn')
    assert.equal(packageOfSpecifier('lodash-es/debounce'), 'lodash-es')
    assert.equal(packageOfSpecifier('mobx'), 'mobx')
    for (const specifier of ['./sibling', '../up', '/abs', 'node:fs', '']) {
      assert.equal(packageOfSpecifier(specifier), null, specifier)
    }
    assert.equal(typesPackageOf('unist'), '@types/unist')
    assert.equal(typesPackageOf('@scope/name'), '@types/scope__name')
  })

  it('reads real import statements in shipped source, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aglyn-deps-'))
    try {
      mkdirSync(join(dir, 'src', 'lib'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'lib', 'a.ts'),
        [
          "import { observable } from 'mobx'",
          "import type { Node } from 'unist'",
          "import {",
          "  a,",
          "  b,",
          "} from '@aglyn/aglyn/app-utils/thing'",
          "export * from '@aglyn/shared-util-tools'",
          "export { x } from 'rxjs/operators'",
          "import 'side-effect-pkg'",
          "const lazy = () => import('lazy-pkg/sub')",
          "const old = require('cjs-pkg')",
          "import { self } from '@aglyn/own/inner'",
          "import { readFileSync } from 'node:fs'",
          "import { join } from 'path'",
          "import { local } from './local'",
          "// import { ghost } from 'commented-out'",
          " * measured against `@firebase/firestore` 4.17.1: from 'prose-pkg'",
          "const text = \"a sentence that says from 'a-quoted-word' in a string\"",
        ].join('\n'),
      )
      writeFileSync(join(dir, 'src', 'lib', 'a.spec.ts'), "import { it } from 'spec-only-pkg'\n")
      writeFileSync(join(dir, 'src', 'lib', 'a.stories.tsx'), "import { Meta } from '@storybook/react'\n")
      assert.deepEqual(packagesImported(dir, '@aglyn/own'), [
        '@aglyn/aglyn',
        '@aglyn/shared-util-tools',
        'cjs-pkg',
        'lazy-pkg',
        'mobx',
        'rxjs',
        'side-effect-pkg',
        'unist',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('splits the framework families from the rest', () => {
    assert.deepEqual(declarationsOwed(['@mui/material', 'mobx', 'next', 'react', 'rxjs']), {
      peers: ['@mui/material', 'next', 'react'],
      dependencies: ['mobx', 'rxjs'],
    })
  })

  it('refuses an undeclared import and a sibling at the wrong version, and accepts a types package', () => {
    const project = { name: 'besigner-core', root: 'libs/besigner/core', alias: '@aglyn/besigner', deepAlias: true }
    const pkg = {
      name: '@aglyn/besigner',
      version: '2.0.0',
      exports: { '.': {}, './*': {} },
      sideEffects: false,
      license: 'Apache-2.0',
      publishConfig: { access: 'public', provenance: true },
      repository: { type: 'git', url: 'https://github.com/aglyn/aglyn.git', directory: 'libs/besigner/core' },
      peerDependencies: { react: '^19' },
      dependencies: { '@aglyn/aglyn': '1.9.0', '@types/unist': '^3', rxjs: '^7' },
    }
    const findings = packageFindings({
      project,
      pkg,
      rootVersion: '2.0.0',
      peers: ['react'],
      hasServerEntry: false,
      dependencies: ['@aglyn/aglyn', 'mobx', 'rxjs', 'unist'],
      workspacePackages: new Set(['@aglyn/aglyn', '@aglyn/besigner']),
    })
    assert.deepEqual(findings, [
      'dependencies lacks mobx, which the shipped source imports (sync:lib-dependencies writes it)',
      'dependencies["@aglyn/aglyn"] is "1.9.0" but the repo version is "2.0.0" (release:prepare writes it)',
    ])
  })

  it('refuses a third-party range the workspace does not run', () => {
    const project = { name: 'besigner-core', root: 'libs/besigner/core', alias: '@aglyn/besigner', deepAlias: true }
    const pkg = {
      name: '@aglyn/besigner',
      version: '2.0.0',
      exports: { '.': {}, './*': {} },
      sideEffects: false,
      license: 'Apache-2.0',
      publishConfig: { access: 'public', provenance: true },
      repository: { type: 'git', url: 'https://github.com/aglyn/aglyn.git', directory: 'libs/besigner/core' },
      dependencies: { '@swc/helpers': '~0.3.3', mobx: '^6' },
    }
    const findings = packageFindings({
      project,
      pkg,
      rootVersion: '2.0.0',
      peers: [],
      hasServerEntry: false,
      rootRanges: { '@swc/helpers': '0.5.23', mobx: '^6' },
    })
    assert.deepEqual(findings, [
      'dependencies["@swc/helpers"] is "~0.3.3" but the workspace runs "0.5.23" (sync:lib-dependencies writes it)',
    ])
  })

  it('THE CONTROL: the same package, declared, has nothing to report', () => {
    // Otherwise the refusal above passes on a check that always finds something.
    const project = { name: 'besigner-core', root: 'libs/besigner/core', alias: '@aglyn/besigner', deepAlias: true }
    const pkg = {
      name: '@aglyn/besigner',
      version: '2.0.0',
      exports: { '.': {}, './*': {} },
      sideEffects: false,
      license: 'Apache-2.0',
      publishConfig: { access: 'public', provenance: true },
      repository: { type: 'git', url: 'https://github.com/aglyn/aglyn.git', directory: 'libs/besigner/core' },
      peerDependencies: { react: '^19' },
      dependencies: { '@aglyn/aglyn': '2.0.0', mobx: '^6' },
    }
    assert.deepEqual(
      packageFindings({
        project,
        pkg,
        rootVersion: '2.0.0',
        peers: ['react'],
        hasServerEntry: false,
        dependencies: ['@aglyn/aglyn', 'mobx'],
        workspacePackages: new Set(['@aglyn/aglyn']),
      }),
      [],
    )
  })
})

describe('the real workspace', () => {
  it('maps every alias to a project and every lib to a package.json the repo version reaches', () => {
    const packageMap = readPackageMap(repoRoot)
    const names = packageMap.map((project) => project.name)
    for (const name of ['aglyn', 'besigner-core', 'besigner-feature-designer', 'aglyn-node-renderer', 'tenant-runtime', 'plugins-crm', 'console', 'tenant']) {
      assert.ok(names.includes(name), `${name} is in the map`)
    }
    for (const project of packageMap.filter((project) => project.projectType === 'library')) {
      assert.ok(project.alias, `${project.name} has an @aglyn alias`)
    }
    const versioned = versionedLibPackages(repoRoot)
    assert.ok(versioned.length >= 40, `${versioned.length} versioned libs`)
    assert.ok(!versioned.some((entry) => entry.name === 'cli'))
    const rootVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
    for (const entry of versioned) {
      assert.equal(JSON.parse(readFileSync(join(repoRoot, entry.path), 'utf8')).version, rootVersion, entry.path)
    }
  })

  it('carries every scope the map names in at least one constraint', () => {
    const sources = new Set(DEP_CONSTRAINTS.map((constraint) => constraint.sourceTag))
    for (const scope of ['scope:shared', 'scope:core', 'scope:renderer', 'scope:besigner', 'scope:besigner-ui', 'scope:tenant', 'scope:console', 'scope:plugin']) {
      assert.ok(sources.has(scope), scope)
    }
  })
})

describe('a sideEffects list is read by two bundlers', () => {
  it('accepts false, and a module named with its extension left open', () => {
    assert.deepEqual(sideEffectsFindings(false), [])
    assert.deepEqual(sideEffectsFindings(['./src/lib/server.*'], (stem) => stem === './src/lib/server'), [])
  })

  it('refuses the source extension, which a consumer of the built package never matches', () => {
    const findings = sideEffectsFindings(['./src/lib/server.ts'])
    assert.equal(findings.length, 1)
    assert.match(findings[0], /extension left open/)
  })

  it('refuses the emitted extension too, which this repo never matches', () => {
    assert.equal(sideEffectsFindings(['./src/lib/server.js']).length, 1)
  })

  it('refuses an entry that outlived its module', () => {
    const findings = sideEffectsFindings(['./src/lib/gone.*'], () => false)
    assert.match(findings[0], /matches no module/)
  })
})

describe('a package says how it publishes', () => {
  const project = { name: 'plugins-crm', root: 'libs/plugins/crm', alias: '@aglyn/plugins-crm', deepAlias: true }
  const base = {
    name: '@aglyn/plugins-crm',
    version: '1.0.0',
    exports: { '.': {}, './*': {} },
    sideEffects: false,
  }
  const findingsFor = (extra) => packageFindings({ project, pkg: { ...base, ...extra }, rootVersion: '1.0.0', peers: [], hasServerEntry: false })

  it('refuses a missing license, restricted access and a directory that is not the package', () => {
    const findings = findingsFor({ repository: { directory: 'libs/plugins/forms' } })
    assert.ok(findings.some((finding) => /Apache-2\.0/.test(finding)))
    assert.ok(findings.some((finding) => /publish restricted/.test(finding)))
    assert.ok(findings.some((finding) => /repository\.directory/.test(finding)))
  })

  it('accepts a package that states all three', () => {
    assert.deepEqual(
      findingsFor({ license: 'Apache-2.0', publishConfig: { access: 'public' }, repository: { type: 'git', url: 'x', directory: 'libs/plugins/crm' } }),
      [],
    )
  })
})
