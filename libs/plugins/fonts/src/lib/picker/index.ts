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

import { CONSOLE_WIDGET_SLOTS, type ConsoleWidget } from '@aglyn/aglyn'
import { FontPicker } from './font-picker.component'

/**
 * The font picker's widgets (AGL-3656): the body and heading fonts in the
 * theme editor's Typography card, first among the `themeEditorFonts`
 * zone's controls.
 */
export const FONT_PICKER_WIDGETS: ConsoleWidget[] = [
  {
    slot: CONSOLE_WIDGET_SLOTS.themeEditorFonts,
    widgetId: 'font-picker',
    title: 'Fonts',
    Component: FontPicker as never,
  },
]
