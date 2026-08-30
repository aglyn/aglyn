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
 * The automation section is named for what its tabs have in common.
 *
 * A section called Workflows containing a tab called Workflows gives one word
 * two jobs, and the reader cannot tell from a sentence like "on the Workflows
 * page" which of the two is meant. Automation is the parent; Workflows,
 * Actions and Webhooks are what is under it.
 *
 * What this file is really holding is the LINE between the halves of that
 * rename. A display label costs nothing to change. A stored identifier — the
 * plugin id on every org's enabled list, the entitlement flag on every plan,
 * the Remote Config release key, a `?tab=` id somebody bookmarked — costs the
 * data that already names it, so those are asserted UNCHANGED here, next to
 * the labels that did move.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Route } from '@aglyn/aglyn/app-utils/console-routes'

const REPO = join(__dirname, '..', '..', '..')
const readRepo = (path: string) => readFileSync(join(REPO, path), 'utf8')

const PLUGIN = 'libs/plugins/workflows/src/lib/plugin.ts'
/**
 * The section ids, read from where they are DEFINED.
 *
 * They used to be inline in the console page; the routed-sections conversion
 * moved them into their own module, and a regex still pointing at the page
 * matched nothing and reported the section as having no tabs at all — a guard
 * about which ids exist, answering "none" and calling that a pass. Read the
 * canonical list so a future move breaks the import rather than the meaning.
 */
const PAGE =
  'libs/plugins/workflows/src/lib/components/workflows-console-sections.ts'
const NEXT_CONFIG = 'apps/console/next.config.js'
const RELEASE_FLAGS = 'libs/aglyn/src/lib/app-utils/release-flags.ts'
const ENABLED_PLUGINS = 'libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts'

/** A route-table path as Next writes it in `redirects()`: `[x]` → `:x`. */
const asNextSource = (route: string) => route.replace(/\[(\w+)]/g, ':$1')

/** Every `id:` on the console page's `HubTabs` list, in order. */
const tabIds = (source: string): string[] =>
  (() => {
    // The exported array only. ⚠️ Anchor on `= [`, not on the constant name:
    // the type annotation `ConsoleNavSection[]` carries a `]` of its own, and
    // slicing to the first one stops before a single id — which reads as "this
    // section has no tabs" and passes a guard about which tabs exist.
    const open = source.indexOf('= [', source.indexOf('WORKFLOWS_CONSOLE_SECTIONS'))
    const body = source.slice(open, source.indexOf(']', open))
    return [...body.matchAll(/\bid: '([a-z-]+)'/g)].map((match) => match[1])
  })()

describe('the automation section', () => {
  it('THE DEFECT: no tab inside the section shares the section name', () => {
    const parent = readRepo(PLUGIN).match(/label: '([^']+)',\n\s+\/\//)?.[1]
    expect(parent).toBe('Automation')
    // Lowercased, because the failure is one word doing two jobs — the
    // casing it happens to be written in is not what makes it ambiguous.
    const children = tabIds(readRepo(PAGE))
    expect(children).toEqual(['workflows', 'actions', 'webhooks'])
    expect(children).not.toContain(parent!.toLowerCase())
  })

  it('names the section Automation everywhere a reader sees it', () => {
    const plugin = readRepo(PLUGIN)
    expect(plugin).toContain(`displayName: 'Automation'`)
    expect(plugin).toContain(`label: 'Automation'`)
    expect(plugin).toContain(`title: 'Automation'`)
    // The staff flags screen and the workspace plugin switchboard name the
    // same section, so a rename that stops at the nav leaves two screens
    // calling it something the console no longer does.
    expect(readRepo(RELEASE_FLAGS)).toContain(`label: 'Automation'`)
    expect(readRepo(ENABLED_PLUGINS)).toContain(
      `{ id: 'workflows', label: 'Automation'`,
    )
  })

  it('THE OLD ADDRESS still resolves', () => {
    /*
     * `/…/hosts/…/workflows` is on the route table only so this rule can be
     * checked against it. Both paths are read from the table rather than
     * written out here: a redirect whose source drifts from the address it is
     * meant to rescue rescues nothing, and it would look right doing it.
     */
    const config = readRepo(NEXT_CONFIG)
    expect(config).toContain(`source: '${asNextSource(Route.HOST_WORKFLOWS)}'`)
    expect(config).toContain(
      `destination: '${asNextSource(Route.HOST_AUTOMATION)}'`,
    )
  })

  it('THE CONTROL: the route table really moved', () => {
    // A redirect from a path to itself passes the test above while doing
    // nothing, which is what a half-finished rename would leave behind.
    expect(Route.HOST_AUTOMATION).not.toBe(Route.HOST_WORKFLOWS)
    expect(Route.HOST_AUTOMATION.endsWith('/automation')).toBe(true)
    expect(readRepo(PLUGIN)).toContain(`href: '/automation'`)
  })

  it('builds links to the new address, not the redirected one', () => {
    // The redirect is for links already out in the world. Anything the
    // console emits today should arrive without a bounce.
    const emitters = [
      'apps/console/components/global-search/global-search-scope.ts',
      'libs/aglyn/src/lib/app-utils/activity-presenter.ts',
    ]
    for (const path of emitters) {
      const source = readRepo(path)
      expect(source).toContain('Route.HOST_AUTOMATION')
      expect(source).not.toContain('Route.HOST_WORKFLOWS')
    }
  })

  it('leaves every STORED identifier alone', () => {
    /*
     * These are the ones a rename would orphan, each named by data that
     * already exists:
     *   `workflows`         — org/site enabled-plugin lists, and the plan
     *                         entitlement flag every paid tier carries
     *   `release_workflows` — the Remote Config parameter
     *   `nav-tab-workflows` — what the release flag gates the tab by
     *   the `?tab=` ids     — bookmarks, and the links the docs publish
     */
    const plugin = readRepo(PLUGIN)
    expect(plugin).toContain(`featureFlag: 'workflows'`)
    expect(plugin).toContain(`navTabId: 'nav-tab-workflows'`)
    expect(readRepo(RELEASE_FLAGS)).toContain(`key: 'release_workflows'`)
    expect(readRepo(RELEASE_FLAGS)).toContain(`navTabId: 'nav-tab-workflows'`)
    expect(readRepo(ENABLED_PLUGINS)).toContain(`id: 'workflows'`)
    expect(tabIds(readRepo(PAGE))).toEqual(['workflows', 'actions', 'webhooks'])
  })
})
