/**
 * First-party plugin scaffolder (AGL-425) — Strapi `sdk-plugin init`
 * parity for this repo.
 *
 *   node tools/scripts/create-plugin.mjs <id> [--label "My Plugin"]
 *     [--surfaces console,site,tenantApi,consoleApi]   (default: console)
 *
 * Generates a complete `libs/plugins/<id>` library (project.json tagged
 * `aglyn:addons`, tsconfigs, jest/eslint, barrel + register entries per
 * surface, a stub console page, and a passing spec), registers the plugin
 * in `plugins.config.json`, adds the tsconfig path aliases, and re-runs
 * the loader-manifest codegen. Prints the manual follow-ups (catalog entry
 * + release flag) it deliberately does not auto-edit.
 *
 * Community/marketplace plugins use `tools/plugin-loader/realm/template`
 * instead — they build standalone bundles against the host ABI.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const [, , rawId, ...rest] = process.argv
const id = String(rawId ?? '').trim()
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(
    'Usage: node tools/scripts/create-plugin.mjs <id> [--label "My Plugin"] ' +
      '[--surfaces console,site,tenantApi,consoleApi]\n' +
      'The id must be kebab-case (it becomes @aglyn/plugins-<id> and the ' +
      'stable org.enabledPlugins id).',
  )
  process.exit(1)
}

const readFlag = (name) => {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 ? rest[index + 1] : undefined
}
const pascal = id
  .split('-')
  .map((part) => part[0].toUpperCase() + part.slice(1))
  .join('')
const label = readFlag('label') ?? pascal.replace(/([a-z])([A-Z])/g, '$1 $2')
const surfaces = (readFlag('surfaces') ?? 'console')
  .split(',')
  .map((surface) => surface.trim())
  .filter(Boolean)
const KNOWN_SURFACES = ['console', 'site', 'tenantApi', 'consoleApi']
for (const surface of surfaces) {
  if (!KNOWN_SURFACES.includes(surface)) {
    console.error(`Unknown surface "${surface}" (expected ${KNOWN_SURFACES.join('/')})`)
    process.exit(1)
  }
}

const libDir = join(repoRoot, 'libs', 'plugins', id)
if (existsSync(libDir)) {
  console.error(`libs/plugins/${id} already exists`)
  process.exit(1)
}

const LICENSE = `/**
 * @license
 * Copyright ${new Date().getFullYear()} Aglyn LLC
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
`

const write = (relative, content) => {
  const file = join(libDir, relative)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  console.log(`  create libs/plugins/${id}/${relative}`)
}

// --- Library plumbing (mirrors the redirects reference plugin). -----------

write(
  'project.json',
  JSON.stringify(
    {
      name: `plugins-${id}`,
      $schema: '../../../node_modules/nx/schemas/project-schema.json',
      sourceRoot: `libs/plugins/${id}/src`,
      projectType: 'library',
      tags: ['aglyn:addons'],
      targets: {
        build: {
          executor: '@nx/rollup:rollup',
          outputs: ['{options.outputPath}'],
          options: {
            outputPath: `dist/libs/plugins/${id}`,
            tsConfig: `libs/plugins/${id}/tsconfig.lib.json`,
            project: `libs/plugins/${id}/package.json`,
            entryFile: `libs/plugins/${id}/src/index.ts`,
            external: ['react/jsx-runtime'],
            rollupConfig: [
              '@nx/react/plugins/bundle-rollup',
              'tools/rollup-external-packages.js',
              'tools/rollup-suppress-use-client.js',
              'tools/rollup-skip-typecheck.js',
            ],
            compiler: 'swc',
            assets: [
              { glob: `libs/plugins/${id}/README.md`, input: '.', output: '.' },
            ],
            updateBuildableProjectDepsInPackageJson: true,
            skipTypeCheck: true,
          },
        },
        lint: {
          executor: '@nx/eslint:lint',
          outputs: ['{options.outputFile}'],
        },
        test: {
          executor: '@nx/jest:jest',
          outputs: [`{workspaceRoot}/coverage/libs/plugins/${id}`],
          options: { jestConfig: `libs/plugins/${id}/jest.config.ts` },
        },
      },
    },
    null,
    2,
  ) + '\n',
)

write(
  'package.json',
  JSON.stringify(
    {
      name: `@aglyn/plugins-${id}`,
      version: '0.0.1',
      type: 'module',
      dependencies: { '@swc/helpers': '~0.3.3' },
      devDependencies: {},
    },
    null,
    2,
  ) + '\n',
)

write(
  'tsconfig.json',
  JSON.stringify(
    {
      extends: '../../../tsconfig.base.json',
      compilerOptions: { strict: false },
      files: [],
      include: [],
      references: [
        { path: './tsconfig.lib.json' },
        { path: './tsconfig.spec.json' },
      ],
    },
    null,
    2,
  ) + '\n',
)

write(
  'tsconfig.lib.json',
  JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: {
        outDir: '../../../dist/out-tsc',
        types: ['@tshelpers', 'node', '@jsx'],
      },
      files: [
        '../../../node_modules/@nx/react/typings/cssmodule.d.ts',
        '../../../node_modules/@nx/react/typings/image.d.ts',
      ],
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.spec.tsx',
        '**/*.test.tsx',
        'jest.config.ts',
      ],
      include: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
    },
    null,
    2,
  ) + '\n',
)

write(
  'tsconfig.spec.json',
  JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: {
        outDir: '../../../dist/out-tsc',
        types: ['@tshelpers', 'jest', 'node', '@jsx'],
      },
      files: [
        '../../../node_modules/@nx/react/typings/cssmodule.d.ts',
        '../../../node_modules/@nx/react/typings/image.d.ts',
      ],
      include: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.spec.tsx',
        '**/*.test.tsx',
        '**/*.spec.js',
        '**/*.test.js',
        '**/*.spec.jsx',
        '**/*.test.jsx',
        '**/*.d.ts',
        'jest.config.ts',
      ],
    },
    null,
    2,
  ) + '\n',
)

write(
  'jest.config.ts',
  `/* eslint-disable */
export default {
  displayName: 'plugins-${id}',
  preset: '../../../jest.preset.js',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\\\.[tj]sx?$': [
      '@swc/jest',
      { swcrc: false, jsc: { transform: { react: { runtime: 'automatic' } } } },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../../coverage/libs/plugins/${id}',
}
`,
)

write(
  'eslint.config.mjs',
  `import baseConfig from '../../../eslint.config.mjs'

export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {},
  },
]
`,
)

write(
  'README.md',
  `# @aglyn/plugins-${id}

${label} feature plugin. Scaffolded by \`tools/scripts/create-plugin.mjs\`
(AGL-425); see \`apps/docs/docs/developers/plugins/building-feature-plugins.md\` for
every extension surface and the loading model.

- Surfaces: ${surfaces.join(', ')}
- Loaded per workspace via \`org.enabledPlugins\` ('${id}') and the
  generated loader manifests (\`plugins.config.json\`).
`,
)

// --- Source ---------------------------------------------------------------

const barrelExports = ["export * from './lib/constants/bundle-common'"]
if (surfaces.includes('console') || surfaces.includes('site')) {
  barrelExports.push("export * from './lib/plugin'")
}
write('src/index.ts', `${LICENSE}\n${barrelExports.join('\n')}\n`)

write(
  'src/lib/constants/bundle-common.ts',
  `${LICENSE}
/** Stable plugin id — persisted in org.enabledPlugins; never rename. */
export const BUNDLE_ID = '${id}'
`,
)

if (surfaces.includes('console') || surfaces.includes('site')) {
  const registerFns = []
  if (surfaces.includes('console')) {
    registerFns.push(`/**
 * Console half: nav item + page through the ConsoleExtension registry.
 * Add widgets/providers/dashboardCards/settingsSections as needed.
 */
export function register${pascal}Console(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: '${label}',
    navItems: [
      {
        label: '${label}',
        href: '/${id}',
        header: { title: '${label}' },
        Component: ${pascal}ConsolePage,
      },
    ],
  })
}`)
  }
  if (surfaces.includes('site')) {
    registerFns.push(`/**
 * Site half: canvas components and/or site runtimes. Register components
 * with defineUiFeatureBundle (see plugins-mui) or a runtime with
 * registerSiteRuntime — runtimes read back the props your server
 * enricher wrote.
 */
export function register${pascal}Site(): void {
  // Aglyn.registerSiteRuntime({ runtimeId: '${id}', Component: ... })
}`)
  }
  write(
    'src/lib/plugin.ts',
    `${LICENSE}
import * as Aglyn from '@aglyn/aglyn'
${surfaces.includes('console') ? "import { lazy } from 'react'\n" : ''}import { BUNDLE_ID } from './constants/bundle-common'

${
  surfaces.includes('console')
    ? `/** Code-split: the console page only loads when opened. */
const ${pascal}ConsolePage = lazy(
  () => import('./components/${id}-console-page'),
)

`
    : ''
}${registerFns.join('\n\n')}
`,
  )
}

if (surfaces.includes('console')) {
  write(
    `src/lib/components/${id}-console-page.tsx`,
    `${LICENSE}'use client'

import type { ConsolePluginPageProps } from '@aglyn/aglyn'

/**
 * ${label} console page. Receives {@link ConsolePluginPageProps}:
 * hostId, entitled, org (org billing doc), permissions.
 */
export default function ${pascal}ConsolePage(props: ConsolePluginPageProps) {
  return (
    <div data-testid="${id}-console-page">
      {'${label} — replace me (hostId: '}
      {props.hostId}
      {')'}
    </div>
  )
}
`,
  )
}

if (surfaces.includes('tenantApi') || surfaces.includes('consoleApi')) {
  const apiFns = []
  if (surfaces.includes('tenantApi')) {
    apiFns.push(`/** Tenant-side API handlers, dispatched under /api/${id}/*. */
export function register${pascal}Api(): void {
  registerPluginApiRoute('${id}/ping', async (request, response) => {
    return response.status(200).json({ ok: true, plugin: BUNDLE_ID })
  })
}`)
  }
  if (surfaces.includes('consoleApi')) {
    apiFns.push(`/** Console-side API handlers, dispatched under /api/${id}/*. */
export function register${pascal}ConsoleApi(): void {
  registerPluginApiRoute('${id}/ping', async (request, response) => {
    return response.status(200).json({ ok: true, plugin: BUNDLE_ID })
  })
}`)
  }
  write(
    'src/lib/server.ts',
    `${LICENSE}
import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { BUNDLE_ID } from './constants/bundle-common'

${apiFns.join('\n\n')}
`,
  )
}

if (surfaces.includes('console')) {
  write(
    'src/lib/plugin.spec.ts',
    `${LICENSE}
import { listConsoleExtensions } from '@aglyn/aglyn'
import { register${pascal}Console } from './plugin'

describe('${id} plugin', () => {
  it('registers its console extension', () => {
    register${pascal}Console()
    const extension = listConsoleExtensions().find(
      (entry) => entry.pluginId === '${id}',
    )
    expect(extension?.displayName).toBe('${label}')
    expect(extension?.navItems?.length).toBeGreaterThan(0)
  })
})
`,
  )
}

// --- Workspace registration ------------------------------------------------

// tsconfig.base.json path aliases (alphabetical-ish: after plugins-<prev>).
const tsconfigPath = join(repoRoot, 'tsconfig.base.json')
const tsconfig = readFileSync(tsconfigPath, 'utf8')
const aliasBlock =
  `      "@aglyn/plugins-${id}": ["libs/plugins/${id}/src/index.ts"],\n` +
  `      "@aglyn/plugins-${id}/*": ["libs/plugins/${id}/src/lib/*"],\n`
const anchor = tsconfig.match(/^ {6}"@aglyn\/plugins-[a-z-]+": \[/m)
if (!anchor) {
  console.error('Could not find the plugins path-alias block in tsconfig.base.json')
  process.exit(1)
}
writeFileSync(
  tsconfigPath,
  tsconfig.replace(anchor[0], aliasBlock + anchor[0]),
)
console.log('  update tsconfig.base.json (path aliases)')

// plugins.config.json entry.
const configPath = join(repoRoot, 'plugins.config.json')
const pluginsConfig = JSON.parse(readFileSync(configPath, 'utf8'))
const register = {}
if (surfaces.includes('site')) register.site = `register${pascal}Site`
if (surfaces.includes('console')) register.console = `register${pascal}Console`
if (surfaces.includes('tenantApi')) register.tenantApi = `register${pascal}Api`
if (surfaces.includes('consoleApi')) {
  register.consoleApi = `register${pascal}ConsoleApi`
}
pluginsConfig.plugins.push({
  id,
  package: `@aglyn/plugins-${id}`,
  register,
  ...(surfaces.includes('tenantApi') || surfaces.includes('consoleApi')
    ? { apiPrefixes: [id] }
    : {}),
})
writeFileSync(configPath, JSON.stringify(pluginsConfig, null, 2) + '\n')
console.log('  update plugins.config.json')

// Regenerate the loader manifests.
execSync('node tools/scripts/generate-plugin-manifests.mjs', {
  cwd: repoRoot,
  stdio: 'inherit',
})

console.log(`
Done. Manual follow-ups (deliberately not auto-edited):
1. Add { id: '${id}', label: '${label}', description: '…', releaseFlag: 'release_${id.replace(/-/g, '_')}' }
   to FIRST_PARTY_PLUGINS in libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts.
2. Register the release flag (AGL-422 three-synced-places):
   - ReleaseFlagKey + RELEASE_FLAGS entry in libs/aglyn/src/lib/app-utils/release-flags.ts
   - parameter in cloud/firebase-remoteconfig.template.json
3. nx lint plugins-${id} && nx test plugins-${id}, then commit.
`)
