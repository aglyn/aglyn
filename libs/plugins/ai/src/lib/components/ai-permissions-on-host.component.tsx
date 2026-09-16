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
'use client'

import { useMemo, type ComponentProps } from 'react'
import { AI_PLUGIN_ID } from '../constants'
import { aiPermissionsOf } from '../model/ai-permissions'
import { AiAssistProvider } from './ai-assist-provider.component'
import { AssistPanelComponent } from './assist-panel.component'

/**
 * What the console shell hands a provider and the assistant dock (AGL-2984):
 * the reader's verdict for every catalog key a plugin declared, on the site
 * in view, with `loaded` false until every read behind it has answered.
 */
export interface ShellPermissionsOnHost {
  loaded: boolean
  granted: Readonly<Record<string, boolean>>
}

/** The AI half of that answer, in the shape the AI surfaces hold on. */
export interface AiPermissionsAnswer {
  loaded: boolean
  use: boolean
  generate: boolean
}

const HELD: AiPermissionsAnswer = { loaded: false, use: false, generate: false }

/**
 * The shell's answer read for the two AI keys. `undefined` while the shell
 * has handed nothing, which the provider reads as pending; one object per
 * verdict, so the callbacks keyed on it are not rebuilt on every render.
 */
export function useAiPermissionsOnHost(
  answer: ShellPermissionsOnHost | undefined,
): AiPermissionsAnswer | undefined {
  const present = answer !== undefined
  const loaded = answer?.loaded === true
  const verdict = aiPermissionsOf(loaded ? answer?.granted : null)
  const use = verdict['ai.use']
  const generate = verdict['ai.generate']
  return useMemo(
    () => (present ? { loaded, use, generate } : undefined),
    [present, loaded, use, generate],
  )
}

type ProviderProps = Omit<ComponentProps<typeof AiAssistProvider>, 'aiPermissions'> & {
  permissionsOnHost?: ShellPermissionsOnHost
  /**
   * The plugins that run on the site in view, as the shell resolved them
   * (AGL-3028). Absent where the shell hands none, which reads as no site
   * narrowing at all.
   */
  enabledPluginIds?: readonly string[]
}

/**
 * Every AI door closed, as a settled answer: what the provider holds on a site
 * that switched AI off. One object, so the callbacks keyed on it are stable.
 */
const OFF_FOR_SITE: AiPermissionsAnswer = { loaded: true, use: false, generate: false }

/**
 * The besigner copy assistant's provider, holding on the shell's permission
 * answer.
 *
 * On a site with AI switched off (AGL-3028) it stays MOUNTED — it wraps every
 * console page, and a provider that came and went per site would remount the
 * whole tree beneath it — and opens nothing: a settled refusal publishes no
 * callback, so no control can reach its dialogs.
 */
export function AiAssistProviderOnHost(props: ProviderProps) {
  const { permissionsOnHost, enabledPluginIds, ...rest } = props
  const aiPermissions = useAiPermissionsOnHost(permissionsOnHost)
  const offForSite = Boolean(enabledPluginIds) && !enabledPluginIds?.includes(AI_PLUGIN_ID)
  return (
    <AiAssistProvider {...rest} aiPermissions={offForSite ? OFF_FOR_SITE : aiPermissions} />
  )
}
AiAssistProviderOnHost.displayName = 'AiAssistProviderOnHost'

type PanelProps = Omit<ComponentProps<typeof AssistPanelComponent>, 'aiPermissions'> & {
  permissionsOnHost?: ShellPermissionsOnHost
}

/** The assistant dock, holding on the shell's permission answer. */
export function AssistPanelOnHost(props: PanelProps) {
  const { permissionsOnHost, ...rest } = props
  const aiPermissions = useAiPermissionsOnHost(permissionsOnHost) ?? HELD
  return <AssistPanelComponent {...rest} aiPermissions={aiPermissions} />
}
AssistPanelOnHost.displayName = 'AssistPanelOnHost'
