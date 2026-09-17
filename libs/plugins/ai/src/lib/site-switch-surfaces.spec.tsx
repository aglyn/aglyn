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
 * The AI plugin's console surfaces, on a site that switched AI off (AGL-3028).
 *
 * The shell lists a zone's widgets against the site's resolved plugin set on
 * a site's pages, and against the workspace's everywhere else. So which zone
 * an AI widget is registered into decides whether a site's switch hides it:
 * the dock, every Describe it, the SEO and theme cards, the collaborator
 * columns, the editor's AI controls and the automation controls all sit in
 * SITE zones and go; the billing cards, the member usage and the agency batch
 * sit in WORKSPACE zones and stay, because they carry no site; the staff zones
 * name no workspace at all.
 *
 * Every zone the plugin registers into is classified below, and a widget
 * added to an unclassified zone fails the first test — it has to say which
 * half of AI it belongs to before it ships.
 */

import {
  CONSOLE_STAFF_WIDGET_SLOTS,
  CONSOLE_WIDGET_SLOTS,
  listConsoleExtensions,
  listConsoleProviders,
  listConsoleWidgets,
  resolveEnabledPlugins,
  resolveHostEnabledPlugins,
} from '@aglyn/aglyn'
import { render } from '@testing-library/react'
import { useContext } from 'react'

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'user-1', getIdToken: async () => 'token' } }),
}))

import { AiAssistActionsContext, type AiAssistActions } from './components/ai-assist-actions-context'
import {
  AiAssistProviderOnHost,
  type ShellPermissionsOnHost,
} from './components/ai-permissions-on-host.component'
import { AI_PLUGIN_ID } from './constants'
import { registerAiConsole } from './plugin'

/** Zones drawn on a SITE's pages, from the site's own plugin set. */
const SITE_ZONES: readonly string[] = [
  // The dock is mounted on every page; on a site's pages it is listed from
  // the site's set, so a switched-off site draws none.
  CONSOLE_WIDGET_SLOTS.assistPanel,
  CONSOLE_WIDGET_SLOTS.hostScreens,
  // Describe it on a site's Templates, Layouts and Forms pages (AGL-3043).
  // The Forms page is the forms plugin's, which draws its zone through the
  // shell's slot, so the site's set decides there too.
  CONSOLE_WIDGET_SLOTS.hostTemplates,
  CONSOLE_WIDGET_SLOTS.hostLayouts,
  CONSOLE_WIDGET_SLOTS.hostForms,
  // And on its Components page (AGL-3051).
  CONSOLE_WIDGET_SLOTS.hostComponents,
  CONSOLE_WIDGET_SLOTS.hostSeo,
  CONSOLE_WIDGET_SLOTS.seoFields,
  CONSOLE_WIDGET_SLOTS.hostTheme,
  CONSOLE_WIDGET_SLOTS.hostMembers,
  CONSOLE_WIDGET_SLOTS.besignerToolbar,
  CONSOLE_WIDGET_SLOTS.besignerInspector,
  // The Automation page's zones, hosted by the workflows plugin on a site's page.
  CONSOLE_WIDGET_SLOTS.hostAutomations,
  CONSOLE_WIDGET_SLOTS.automationEditor,
  CONSOLE_WIDGET_SLOTS.automationRun,
  // The commerce zones a site's products pages host (AGL-2916).
  CONSOLE_WIDGET_SLOTS.productEditor,
  CONSOLE_WIDGET_SLOTS.productsHub,
  CONSOLE_WIDGET_SLOTS.productImport,
  // The CRM's record pages, composer and imports (AGL-2917). Under a site
  // they are listed from the site's set; at the organization level, from the
  // workspace's, where a job still names the record's site when it has one
  // and the jobs route refuses a site that switched AI off.
  CONSOLE_WIDGET_SLOTS.recordInsights,
  CONSOLE_WIDGET_SLOTS.recordEmail,
  CONSOLE_WIDGET_SLOTS.importMapping,
]

/** Zones drawn on the WORKSPACE's pages, where no site's switch reaches. */
const WORKSPACE_ZONES: readonly string[] = [
  CONSOLE_WIDGET_SLOTS.orgBillingUsage,
  CONSOLE_WIDGET_SLOTS.orgMember,
  CONSOLE_WIDGET_SLOTS.orgMembersListColumn,
  CONSOLE_WIDGET_SLOTS.orgSites,
]

/** A workspace that never listed AI, and one of its sites that switched it off. */
const ORG = { enabledPlugins: ['mui', 'commerce'] }
const SITE_OFF = { disabledPlugins: [AI_PLUGIN_ID] }
const SITE_OLD = { disabledPlugins: ['commerce'] }

const aiWidgets = (zone: string, enabled: readonly string[]) =>
  listConsoleWidgets(zone, enabled).filter(({ extension }) => extension.pluginId === AI_PLUGIN_ID)

beforeAll(() => {
  registerAiConsole()
})

describe('every zone the AI plugin draws into is classified', () => {
  it('names each registered zone exactly once', () => {
    const extension = listConsoleExtensions([AI_PLUGIN_ID]).find(
      (one) => one.pluginId === AI_PLUGIN_ID,
    )
    const zones = new Set((extension?.widgets ?? []).map((widget) => String(widget.slot)))
    const classified = [...SITE_ZONES, ...WORKSPACE_ZONES, ...CONSOLE_STAFF_WIDGET_SLOTS]
    for (const zone of zones) expect(classified).toContain(zone)
    for (const zone of [...SITE_ZONES, ...WORKSPACE_ZONES]) expect(zones).toContain(zone)
  })
})

describe('a site that switched AI off', () => {
  const siteSet = resolveHostEnabledPlugins(ORG, SITE_OFF)

  it.each(SITE_ZONES)('draws no AI widget in %s', (zone) => {
    expect(aiWidgets(zone, siteSet)).toEqual([])
  })

  it.each(SITE_ZONES)('still draws it in %s on a site that never switched AI off', (zone) => {
    expect(aiWidgets(zone, resolveHostEnabledPlugins(ORG, SITE_OLD)).length).toBeGreaterThan(0)
  })

  it.each(WORKSPACE_ZONES)('leaves the workspace’s %s zone alone', (zone) => {
    expect(aiWidgets(zone, resolveEnabledPlugins(ORG)).length).toBeGreaterThan(0)
  })

  it('keeps the copy assistant’s provider in the workspace’s list', () => {
    expect(listConsoleProviders(resolveEnabledPlugins(ORG))).toContain(AiAssistProviderOnHost)
  })
})

describe('the copy assistant’s provider on a switched-off site', () => {
  const GRANTED: ShellPermissionsOnHost = {
    loaded: true,
    granted: { 'ai.use': true, 'ai.generate': true },
  }

  function actionsUnder(enabledPluginIds: readonly string[] | undefined): AiAssistActions {
    let seen: AiAssistActions = {}
    function Probe() {
      seen = useContext(AiAssistActionsContext)
      return null
    }
    render(
      <AiAssistProviderOnHost
        org={{ plan: 'pro' } as never}
        orgReady
        orgId="org-1"
        hostId="host-1"
        permissionsOnHost={GRANTED}
        enabledPluginIds={enabledPluginIds}
      >
        <Probe />
      </AiAssistProviderOnHost>,
    )
    return seen
  }

  it('opens no door: a reader granted both keys gets no callback to draw a control from', () => {
    expect(Object.keys(actionsUnder(resolveHostEnabledPlugins(ORG, SITE_OFF)))).toEqual([])
  })

  it('opens both doors on a site that runs AI', () => {
    expect(Object.keys(actionsUnder(resolveHostEnabledPlugins(ORG, SITE_OLD))).sort()).toEqual([
      'onGenerateSection',
      'onRewrite',
    ])
  })

  it('opens both doors where the shell hands no site set', () => {
    expect(Object.keys(actionsUnder(undefined)).sort()).toEqual(['onGenerateSection', 'onRewrite'])
  })
})
