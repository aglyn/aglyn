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

import type { ConsoleDockZoneProps } from '@aglyn/aglyn'
import type { ComponentProps } from 'react'
import { AssistPanelComponent } from './assist-panel.component'
import {
  useAiPermissionsOnHost,
  type AiPermissionsAnswer,
  type ShellPermissionsOnHost,
} from './ai-assist-provider-on-host.component'

// The provider half lives in its own module (AGL-3649), so the eager
// provider loads nothing of the dock's; it is re-exported here for the
// importers that knew it by this name.
export {
  AiAssistProviderOnHost,
  useAiPermissionsOnHost,
  type AiPermissionsAnswer,
  type ShellPermissionsOnHost,
} from './ai-assist-provider-on-host.component'

const HELD: AiPermissionsAnswer = { loaded: false, use: false, generate: false }

type PanelProps = Omit<
  ComponentProps<typeof AssistPanelComponent>,
  'aiPermissions' | 'assistVisible' | 'assistStaffPreview' | 'generativeVisible'
> & {
  permissionsOnHost?: ShellPermissionsOnHost
  /**
   * The shell's verdict for any release flag (the `consoleDock` zone's
   * `releaseVerdict`): the assistant asks for its own two, so the shell names
   * no AI flag.
   */
  releaseVerdict: ConsoleDockZoneProps['releaseVerdict']
}

/**
 * The assistant, drawn in the console dock, holding on the shell's
 * permission answer and asking the shell for its own release flags.
 */
export function AssistPanelOnHost(props: PanelProps) {
  const { permissionsOnHost, releaseVerdict, ...rest } = props
  const aiPermissions = useAiPermissionsOnHost(permissionsOnHost) ?? HELD
  const assist = releaseVerdict('release_assist')
  const generative = releaseVerdict('release_ai_generative')
  return (
    <AssistPanelComponent
      {...rest}
      assistVisible={assist.visible}
      assistStaffPreview={assist.staffPreview}
      generativeVisible={generative.visible}
      aiPermissions={aiPermissions}
    />
  )
}
AssistPanelOnHost.displayName = 'AssistPanelOnHost'
