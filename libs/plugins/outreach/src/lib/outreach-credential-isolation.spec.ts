/**
 * @jest-environment node
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

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/**
 * Outreach's Google client secret and token key belong to the console, and
 * the tenant runtime must not be able to reach them (AGL-2978).
 *
 * `GOOGLE_OUTREACH_CLIENT_SECRET` and `OUTREACH_TOKEN_KEY` together are the
 * power to send mail as every rep who connected a mailbox: the key opens each
 * stored refresh token and the secret redeems it. The tenant runtime serves
 * published sites to the public internet, and anything it can import is one
 * bug away from a site request. So, as for the Resend domains key
 * (`sending-domain-credential-isolation.spec.ts`), the isolation is a property
 * of where the code lives rather than something remembered.
 *
 * ## What makes it structural here
 *
 * The reader is a PLUGIN module, not a console file, because the plugin owns
 * the flow; the boundary is the plugin loader instead of the app directory.
 * Four facts, each checked below by reading the tree:
 *
 * 1. The three variables are READ in exactly one module,
 *    `libs/plugins/outreach/src/lib/mailboxes/outreach-config.ts`, and named
 *    by no source file outside the Outreach plugin.
 * 2. That module is imported only from inside the plugin.
 * 3. The plugin's client barrel never reaches it, nor the modules that open
 *    or seal a token — a console page importing `@aglyn/plugins-outreach`
 *    gets none of them.
 * 4. The plugin's server half and its console-only declarations are
 *    imported, outside the plugin, only by the console's generated server
 *    manifests; no tenant file names the plugin.
 *
 * It lives with the plugin because every fact it holds is the plugin's; it
 * reads the whole tree, apps included, from here.
 *
 * Moving the read into a shared library, or naming the plugin from a tenant
 * manifest, fails here naming the file.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const SEARCH_ROOTS = ['apps', 'libs', 'tools', 'cloud'].map((dir) => join(REPO_ROOT, dir))
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '.nx', 'tmp'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const SPEC = /\.spec\.[cm]?[jt]sx?$|\/specs\//

/** The variables, spelled in pieces so this file is not a hit for its own sweep. */
const CREDENTIALS = [
  ['GOOGLE', 'OUTREACH', 'CLIENT', 'ID'],
  ['GOOGLE', 'OUTREACH', 'CLIENT', 'SECRET'],
  ['OUTREACH', 'TOKEN', 'KEY'],
].map((parts) => parts.join('_'))

const PLUGIN_ROOT = join('libs', 'plugins', 'outreach') + sep
const READER = join('libs', 'plugins', 'outreach', 'src', 'lib', 'mailboxes', 'outreach-config.ts')
const CLIENT_BARREL = join('libs', 'plugins', 'outreach', 'src', 'index.ts')
const SERVER_MANIFEST = join('apps', 'console', 'constants', 'plugins.server.generated.ts')
const DECLARATIONS_MANIFEST = join('apps', 'console', 'constants', 'plugins.declarations.server.generated.ts')

/** Modules that must never be in the client barrel's reach. */
const SERVER_ONLY_MODULES = [
  READER,
  join('libs', 'plugins', 'outreach', 'src', 'lib', 'mailboxes', 'mailbox-credentials.ts'),
  join('libs', 'plugins', 'outreach', 'src', 'lib', 'mailboxes', 'mailbox-transport.ts'),
  join('libs', 'plugins', 'outreach', 'src', 'lib', 'mailboxes', 'mailbox-routes.ts'),
  join('libs', 'plugins', 'outreach', 'src', 'lib', 'mailboxes', 'mailbox-revoke.ts'),
  join('libs', 'plugins', 'outreach', 'src', 'lib', 'mailboxes', 'mailbox-erasure.ts'),
  join('libs', 'plugins', 'outreach', 'src', 'lib', 'declarations.console-server.ts'),
]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...sourceFiles(full))
    } else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(full)
    }
  }
  return found
}

const FILES = SEARCH_ROOTS.flatMap(sourceFiles).map((path) => ({
  path: relative(REPO_ROOT, path),
  text: readFileSync(path, 'utf8'),
}))
const SHIPPED = FILES.filter((file) => !SPEC.test(file.path))

/** The relative imports of one module, resolved to repo paths that exist. */
function relativeImports(file: { path: string; text: string }): string[] {
  const targets: string[] = []
  for (const match of file.text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = resolve(REPO_ROOT, dirname(file.path), match[1])
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
      if (existsSync(candidate)) {
        targets.push(relative(REPO_ROOT, candidate))
        break
      }
    }
  }
  return targets
}

describe('the sweep can actually see the tree', () => {
  it('reads thousands of source files, including the reader, the barrel and the manifest', () => {
    expect(FILES.length).toBeGreaterThan(1000)
    for (const path of [READER, CLIENT_BARREL, SERVER_MANIFEST, DECLARATIONS_MANIFEST]) {
      expect([path, FILES.some((file) => file.path === path)]).toEqual([path, true])
    }
  })

  it('finds a variable it is NOT policing, so a zero result would be visible', () => {
    expect(SHIPPED.filter((file) => file.text.includes('RESEND_API_KEY')).length).toBeGreaterThan(0)
  })
})

describe('Outreach’s credentials (AGL-2978)', () => {
  it.each(CREDENTIALS)('%s is READ by exactly one module, the plugin’s config', (name) => {
    const read = new RegExp(`process\\s*\\.\\s*env\\s*[.[]\\s*['"\`]?${name}\\b`)
    expect(SHIPPED.filter((file) => read.test(file.text)).map((file) => file.path)).toEqual([READER])
  })

  it.each(CREDENTIALS)('%s is not so much as NAMED by any source outside the Outreach plugin', (name) => {
    const named = SHIPPED.filter((file) => !file.path.startsWith(PLUGIN_ROOT) && file.text.includes(name))
    expect(named.map((file) => file.path)).toEqual([])
  })
})

describe('the config module', () => {
  it('is imported, and only imported, from inside the plugin', () => {
    const importers = SHIPPED.filter(
      (file) => file.path !== READER && /['"][^'"]*outreach-config['"]/.test(file.text),
    ).map((file) => file.path)
    expect(importers.length).toBeGreaterThan(0)
    for (const importer of importers) expect([importer, importer.startsWith(PLUGIN_ROOT)]).toEqual([importer, true])
  })
})

describe('the plugin’s client barrel', () => {
  it('never reaches a module that reads, opens or seals a credential', () => {
    const byPath = new Map(FILES.map((file) => [file.path, file]))
    const reached = new Set<string>()
    const queue = [CLIENT_BARREL]
    while (queue.length) {
      const path = queue.pop() as string
      if (reached.has(path)) continue
      reached.add(path)
      const file = byPath.get(path)
      if (file) queue.push(...relativeImports(file))
    }
    // The walk is real: the barrel reaches the plugin's console registration.
    expect(reached.has(join('libs', 'plugins', 'outreach', 'src', 'lib', 'plugin.ts'))).toBe(true)
    for (const serverOnly of SERVER_ONLY_MODULES) expect([serverOnly, reached.has(serverOnly)]).toEqual([serverOnly, false])
  })
})

describe('the plugin’s server half and console-only declarations', () => {
  it('are imported outside the plugin only by the console’s server manifests', () => {
    const importers = SHIPPED.filter(
      (file) =>
        !file.path.startsWith(PLUGIN_ROOT) &&
        /@aglyn\/plugins-outreach\/(server|declarations\.console-server|mailboxes|transport)/.test(file.text),
    ).map((file) => file.path)
    expect(importers.sort()).toEqual([DECLARATIONS_MANIFEST, SERVER_MANIFEST].sort())
  })

  it('is named by no file in the tenant app', () => {
    const tenant = FILES.filter(
      (file) => file.path.startsWith(join('apps', 'tenant') + sep) && file.text.includes('@aglyn/plugins-outreach'),
    )
    expect(tenant.map((file) => file.path)).toEqual([])
  })
})
