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

import * as Aglyn from '@aglyn/aglyn'
import { renderEmailHtml } from './model'
import { BUNDLE_ID } from './constants/bundle-common'
import {
  EMAIL_BUNDLE,
  registerEmailConsole,
  registerEmailPlugin,
} from './plugin'

/**
 * Email blocks that RENDER what is dropped into them (AGL-1389) — see the
 * mui bundle's list for what this is and why it is an inventory rather than
 * an exemption list.
 */
const EMAIL_DECLARED_CONTAINERS: readonly string[] = ['emailSection']

const SENTINEL = 'child-contract-sentinel'

describe('email plugin', () => {
  it('registers the bundle once with all email blocks', () => {
    registerEmailPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeTruthy()
    expect(() => registerEmailPlugin()).not.toThrow()
    const ids = EMAIL_BUNDLE.map((entry) => entry.schema.$id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'emailSection',
        'emailText',
        'emailRichtext',
        'emailImage',
        'emailButton',
        'emailDivider',
        'emailSpacer',
        'emailProduct',
        'emailHtml',
      ]),
    )
    // Every schema carries the email bundle id.
    for (const entry of EMAIL_BUNDLE) {
      expect(entry.schema.pluginId).toBe(BUNDLE_ID)
    }
  })

  it('lets nothing become a container by accident (AGL-1389)', () => {
    expect(
      Aglyn.auditChildContract(EMAIL_BUNDLE, EMAIL_DECLARED_CONTAINERS),
    ).toEqual([])
  })

  it('keeps every container’s children through compose (AGL-1389)', () => {
    expect(
      Aglyn.auditComposeChildSurvival(
        Aglyn.listAcceptingComponentIds(EMAIL_BUNDLE),
      ),
    ).toEqual([])
  })

  it('renders every container’s children in the EMAIL html too (AGL-1389)', () => {
    // `email-render.ts` is a SECOND render surface with its own switch
    // statement, so the same disagreement can appear there and nowhere else:
    // a block whose case forgets `renderChildren(node.nodes)` swallows an
    // author's node on send while the canvas shows it happily.
    //
    // Unlike the besigner's React tree this one is a pure string function
    // over a node map — no providers, no context, no canvas singleton — so
    // it can be probed for real, with a sentinel, and needs no exemptions.
    // Today only `emailSection` handles children explicitly and the
    // `default` case renders them; this is what keeps the next `case` from
    // quietly dropping one.
    const swallowed: string[] = []
    for (const componentId of Aglyn.listAcceptingComponentIds(EMAIL_BUNDLE)) {
      const { html } = renderEmailHtml({
        rootId: 'root',
        sanitize: (value) => value,
        nodes: {
          root: { componentId: 'div', nodes: ['subject'] },
          subject: { componentId, props: {}, nodes: ['sentinel'] },
          sentinel: { componentId: 'emailText', props: { children: SENTINEL } },
        },
      })
      if (!html.includes(SENTINEL)) swallowed.push(componentId)
    }
    expect(swallowed).toEqual([])
  })
})

/**
 * The email console declares who may open it.
 *
 * This asserts the DECLARATION only; the shell's handling of it is proved at
 * the route in `apps/console/specs/plugin-surface-permission-keys.spec.tsx`.
 */
describe('the email console surface declares its own authorization', () => {
  const consoleExtension = () =>
    Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID)

  beforeEach(() => {
    registerEmailConsole()
  })

  it('requires `data.manage` to open the email console', () => {
    expect(consoleExtension()?.permission).toBe('data.manage')
  })

  it('declares on the EXTENSION, because every surface here is the same one', () => {
    // The opposite arrangement from commerce, and for the opposite reason:
    // this extension registers a single nav item whose sections all belong to
    // one answer, so narrowing an item would only restate the extension's own
    // requirement in a second place that can drift from it.
    expect(consoleExtension()?.navItems?.length).toBe(1)
    expect(consoleExtension()?.navItems?.[0]?.permission).toBeUndefined()
  })

  it('names a key the catalog carries, so a role editor can grant it', () => {
    const permission = consoleExtension()?.permission as Aglyn.OrgPermission
    expect(Aglyn.ORG_PERMISSION_KEYS).toContain(permission)
  })

  it('excludes the VIEWER tier, which is the population it exists to refuse', () => {
    /*
     * The audiences section reads `orgs/{orgId}/lists/{listId}/members` —
     * enrolled contacts and their consent basis. The rules gate that read on
     * `isOrgWideMember()` with no role condition, so an org-wide viewer reads
     * every audience the organization has. This key is chosen because its
     * population is exactly the one `server-list-gate.ts` accepts a list
     * write from, and the viewer it drops is the reader the rules admit.
     */
    const permission = consoleExtension()?.permission as Aglyn.OrgPermission
    expect(Aglyn.DEFAULT_ROLE_PERMISSIONS.owner[permission]).toBe(true)
    expect(Aglyn.DEFAULT_ROLE_PERMISSIONS.admin[permission]).toBe(true)
    expect(Aglyn.DEFAULT_ROLE_PERMISSIONS.editor[permission]).toBe(true)
    expect(Aglyn.DEFAULT_ROLE_PERMISSIONS.viewer[permission]).toBe(false)
  })
})

/*==========================================
 * THE ORGANIZATION'S EMAILS PAGE (AGL-3301).
 *
 * The same page, mounted at `/[orgSlug]/emails` through the shell's generic
 * org route, with the same six sections. Declared as the site item's twin so
 * the two cannot drift: a section added to one and not the other would be a
 * route that exists at one level only.
 *=========================================*/
describe('the email console’s organization page', () => {
  const consoleExtension = () =>
    Aglyn.listConsoleExtensions().find((entry) => entry.pluginId === BUNDLE_ID)

  beforeEach(() => {
    registerEmailConsole()
  })

  it('declares one org surface at `/emails`', () => {
    const orgItems = consoleExtension()?.orgNavItems ?? []
    expect(orgItems).toHaveLength(1)
    expect(orgItems[0].href).toBe('/emails')
    expect(orgItems[0].label).toBe('Emails')
  })

  it('renders the same page with the same sections as the site surface', () => {
    const site = consoleExtension()?.navItems?.[0]
    const org = consoleExtension()?.orgNavItems?.[0]
    expect(org?.Component).toBe(site?.Component)
    expect(org?.sections).toBe(site?.sections)
    expect(org?.sections?.map((section) => section.id)).toEqual([
      'messages',
      'templates',
      'audiences',
      'topics',
      'sending',
      'suppressions',
    ])
  })

  it('carries no tab id at either level, so the plugin’s own flag gates both', () => {
    // `release_email` gates the PLUGIN; a tab id here would add a second,
    // separately switchable gate to one half of the surface.
    expect(consoleExtension()?.navItems?.[0]?.navTabId).toBeUndefined()
    expect(consoleExtension()?.orgNavItems?.[0]?.navTabId).toBeUndefined()
  })

  it('is resolved by the org route, sections included', () => {
    const resolved = Aglyn.resolveConsoleOrgPluginPage('/emails/sending', [
      BUNDLE_ID,
    ])
    expect(resolved?.extension.pluginId).toBe(BUNDLE_ID)
    expect(resolved?.section?.id).toBe('sending')
  })
})
