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

import { registerConsoleExtension } from '@aglyn/aglyn'
import { lazy } from 'react'
import { LIVE_CHAT_PLUGIN_ID, LIVE_CHAT_WIDGET_ID } from './constants'

const LiveChatCard = lazy(() => import('./components/live-chat-card.component'))

/**
 * The console half (AGL-3698): the Live chat card on a site's setup page,
 * loaded when that page is opened, for a site that switched Live chat on.
 */
export function registerLiveChatConsole(): void {
  registerConsoleExtension({
    pluginId: LIVE_CHAT_PLUGIN_ID,
    displayName: 'Live chat',
    widgets: [
      {
        slot: 'hostSettings',
        widgetId: LIVE_CHAT_WIDGET_ID,
        title: 'Live chat',
        Component: LiveChatCard,
      },
    ],
  })
}
