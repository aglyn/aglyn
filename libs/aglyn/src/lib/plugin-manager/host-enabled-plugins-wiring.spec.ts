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

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Per-site plugin enablement wiring guard (AGL-1014).
 *
 * `enabledPlugins` is a boundary, not a preference: it is enforced in four
 * places — console navigation/editor, published sites, and the two API
 * dispatchers — and a per-site override is worth nothing unless every one
 * of them reads the SAME resolver. A collaborator who can still reach a
 * disabled plugin's API by URL has not been restricted, only inconvenienced.
 *
 * This is a static guard in the branding-coverage mould: it asserts each
 * consumer still routes through the host-aware resolver (or the client
 * subtraction that implements it), so silently reverting one surface to the
 * org-only `resolveEnabledPlugins` trips here rather than shipping a hole.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

describe('per-site plugin enablement wiring (AGL-1014)', () => {
  const CONSUMERS: Array<{
    name: string
    file: string
    mustContain: string[]
    mustNotContain?: string[]
  }> = [
    {
      // API dispatch, console origin: the gate must resolve per host.
      name: 'console plugin API dispatcher',
      file: 'apps/console/app/api/[...pluginApi]/route.ts',
      mustContain: ['resolveHostEnabledPlugins', 'getHostDisabledPlugins'],
      mustNotContain: ['resolveEnabledPlugins('],
    },
    {
      // API dispatch, tenant origin: same gate, same resolver.
      name: 'tenant plugin API dispatcher',
      file: 'apps/tenant/app/api/[...pluginApi]/route.ts',
      mustContain: ['resolveHostEnabledPlugins', 'getHostDisabledPlugins'],
      mustNotContain: ['resolveEnabledPlugins('],
    },
    {
      // Published sites: every enabled-plugin set the page loader emits
      // (screens, auth screens, collections) must be the HOST set.
      name: 'tenant page loader',
      file: 'apps/tenant/app/[host]/[[...slug]]/load-page-data.ts',
      mustContain: ['resolveHostEnabledPlugins'],
      mustNotContain: ['resolveEnabledPlugins('],
    },
    {
      // Console navigation + editor: `useEnabledPluginIds` feeds nav tabs,
      // plugin pages and widget slots, and must subtract the host deny-list.
      name: 'console enabled-plugin ids hook',
      file: 'apps/console/components/console-plugins-gate.component.tsx',
      mustContain: ['subtractDisabledPlugins', 'useHostDisabledPlugins'],
    },
    {
      // The EDITOR (AGL-1014): `withSitePlugins` wraps every besigner and
      // preview route, so publishing the set there is what stops a new
      // editor route being added that forgets.
      name: 'console editor-surface gate',
      file: 'apps/console/components/console-plugins-gate.component.tsx',
      mustContain: ['EnabledPluginsContext.Provider', 'useEnabledPluginIds()'],
    },
    {
      // The editor's component drawer — the palette AND the picker read this
      // one hook, and it must filter entries by the site's plugin set. The
      // preset registry is a module-global union that only ever grows, so
      // this read-time filter is the enforcement; loading fewer bundles
      // cannot un-register what an earlier site already registered.
      name: 'besigner component drawer',
      file: 'libs/besigner/feature/designer/src/lib/hooks/use-visible-component-categories.ts',
      mustContain: ['useEnabledPlugins()', 'isFromEnabledPlugin('],
    },
  ]

  it.each(CONSUMERS)('$name consults the per-host flag', (consumer) => {
    const source = read(consumer.file)
    for (const needle of consumer.mustContain) {
      expect(source).toContain(needle)
    }
    for (const needle of consumer.mustNotContain ?? []) {
      // `Aglyn.resolveHostEnabledPlugins(` also matches, so strip the
      // host-aware calls first: what remains must not call the org-only
      // resolver directly.
      const stripped = source.split('resolveHostEnabledPlugins').join('')
      expect(stripped).not.toContain(needle)
    }
  })

  it('the host doc carries the deny-list the resolver reads', () => {
    const types = read(
      'libs/aglyn/src/lib/foundation/definitions/platform.types.ts',
    )
    expect(types).toContain('disabledPlugins?: string[]')
  })

  it('the rules restrict the deny-list to site admins', () => {
    const rules = read('cloud/firebase-firestore.rules')
    expect(rules).toContain("hasAny(['disabledPlugins'])")
  })
})
