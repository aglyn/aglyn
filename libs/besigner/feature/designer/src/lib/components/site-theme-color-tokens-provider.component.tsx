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

import { useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import {
  buildColorTokenOptions,
  ColorPickerTokensContext,
} from '@aglyn/shared-ui-jsx-forms'
import { useHostThemeDocument } from '@aglyn/shared-ui-theme'
import { useMemo } from 'react'

/**
 * Feeds the two-stage color picker (AGL-588) with the SITE theme's
 * palette token references, resolved through BOTH schemes of the host's
 * persisted theme document so every swatch previews its light and dark
 * colors. Mounted around the designer's aside panels, it reaches every
 * COLOR_PICKER field — styles panel, attribute forms, and email block
 * attributes — through the shared field component, with no per-form
 * wiring.
 */
export const SiteThemeColorTokensProvider = (props: {
  children?: JSX.Children
}) => {
  const { children } = props
  const hostThemeDoc = useHostThemeDocument()
  const lightTheme = useAglynSiteTheme({ theme: hostThemeDoc, scheme: 'light' })
  const darkTheme = useAglynSiteTheme({ theme: hostThemeDoc, scheme: 'dark' })
  const options = useMemo(
    () =>
      buildColorTokenOptions(
        lightTheme.palette as unknown as Record<string, unknown>,
        darkTheme.palette as unknown as Record<string, unknown>,
      ),
    [lightTheme, darkTheme],
  )
  return (
    <ColorPickerTokensContext.Provider value={options}>
      {children}
    </ColorPickerTokensContext.Provider>
  )
}
SiteThemeColorTokensProvider.displayName = 'SiteThemeColorTokensProvider'
SiteThemeColorTokensProvider.aglyn = true

export default SiteThemeColorTokensProvider
