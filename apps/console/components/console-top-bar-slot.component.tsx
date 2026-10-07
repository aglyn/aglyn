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

import { useConsoleShellZoneProps } from './console-dock-slot.component'
import PluginWidgetSlot from './plugin-widget-slot.component'

/**
 * The top bar's zone (AGL-3593): `consoleTopBar`, drawn in the bar's status
 * cluster just ahead of the notifications bell, on every page that draws the
 * bar — the app shell, the besigner and the screen view — so a plugin's
 * indicator stays in view wherever the reader is. It hands each widget the
 * console dock's answers, resolved the same way, and draws nothing of its own:
 * every widget is one control in a row the bar spaces.
 */
export default function ConsoleTopBarSlot() {
  const props = useConsoleShellZoneProps()
  return <PluginWidgetSlot slot="consoleTopBar" {...props} />
}
