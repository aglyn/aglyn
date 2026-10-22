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

import type { Theme } from '@mui/material/styles'
import { createContext } from 'react'

/**
 * The CONSOLE's theme, for editor chrome drawn inside the canvas.
 *
 * Inside the canvas `useTheme()` answers with the SITE's theme, which is the
 * design being edited: a repeat badge in the site's `secondary` would be the
 * subscriber's brand colour, and a site theme has no `tertiary` at all. Chrome
 * the canvas draws among the page's own elements (the repeat badge, a token
 * chip) reads its tokens from here instead. Provided once, outside the site's
 * theme provider; undefined outside the canvas.
 */
export const CanvasChromeThemeContext = createContext<Theme | undefined>(
  undefined,
)
CanvasChromeThemeContext.displayName = 'CanvasChromeThemeContext'

export default CanvasChromeThemeContext
