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
import { FONTS_PLUGIN_ID } from './constants'
import { FONT_PICKER_WIDGETS } from './picker'

/**
 * The fonts plugin's console surface (AGL-3656): its controls in the theme
 * editor's Typography card, through the `themeEditorFonts` zone — the font
 * picker first.
 */
export function registerFontsConsole(): void {
  registerConsoleExtension({
    pluginId: FONTS_PLUGIN_ID,
    displayName: 'Fonts',
    widgets: [...FONT_PICKER_WIDGETS],
  })
}
