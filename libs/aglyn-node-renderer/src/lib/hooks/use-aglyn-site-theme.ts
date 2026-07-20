/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import {
  createResponsiveTheme,
  hostThemeToThemeOptions,
} from '@aglyn/shared-ui-theme'
import { useMemo } from 'react'

export type UseAglynSiteThemeOptions = {
  // Node covers ShadowRoot containers, which MUI accepts at runtime but
  // types as Element only.
  container?: Element | Node
  /** Persisted host theme customization; omitted → default light theme (legacy behavior). */
  theme?: HostTheme
  scheme?: HostThemeScheme
}

export function useAglynSiteTheme(options: UseAglynSiteThemeOptions = {}) {
  const container = options.container as Element | undefined
  const hostTheme = options.theme
  const scheme = options.scheme ?? 'light'

  return useMemo(() => {
    const themeOptions = hostThemeToThemeOptions(hostTheme, scheme)
    // createResponsiveTheme, not plain createTheme (AGL-593): the tenant
    // builds host themes through it (HostThemeProvider), which bakes
    // responsive font sizes into the typography variants — the canvas
    // must carry the same media-keyed typography or device preview has
    // nothing to re-resolve and canvas/tenant text sizes disagree.
    return createResponsiveTheme({
      themeOptions: {
        ...themeOptions,
        components: {
          ...themeOptions.components,
          MuiPopover: {
            defaultProps: {
              container: container,
            },
          },
          MuiPopper: {
            defaultProps: {
              container: container,
            },
          },
          MuiModal: {
            defaultProps: {
              container: container,
            },
          },
        },
      },
    })
  }, [container, hostTheme, scheme])
}
export default useAglynSiteTheme
