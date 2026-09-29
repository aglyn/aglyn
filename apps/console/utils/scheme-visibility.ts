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

/**
 * An `sx` entry that shows an element in ONE color scheme and hides it in the
 * other — for a mark that ships as a light-ground and a dark-ground pair (the
 * org logo, the white-label logo).
 *
 * CSS rather than a `useColorScheme()` branch: the console's scheme is the
 * `.dark` class the theme puts on `<html>`, so both variants are in the markup
 * and the stylesheet picks one. A branch on the resolved mode renders the
 * light mark first and swaps it after hydration, which on a dark console is a
 * visible flash of the wrong logo in the app bar.
 */
export const onlyInScheme =
  (scheme: 'light' | 'dark', display = 'block') =>
  (theme: Theme) =>
    scheme === 'light'
      ? { display, ...theme.applyStyles('dark', { display: 'none' }) }
      : { display: 'none', ...theme.applyStyles('dark', { display }) }
