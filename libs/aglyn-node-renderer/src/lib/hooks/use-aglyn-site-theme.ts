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
  consoleOptions,
  consoleOptionsDark,
  createResponsiveTheme,
  hostThemeToThemeOptions,
  mergeThemeOptions,
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
    // Layer the host's overrides onto the BRAND base, exactly as the tenant's
    // HostThemeProvider does (AGL-1180/AGL-1205). `hostThemeToThemeOptions`
    // emits only what the host explicitly set, so building from it alone left
    // every untouched slot on MUI's stock palette — and because the marketing
    // host deliberately keeps its theme all-`Default`, that meant EVERY slot.
    // The canvas and preview were painting `primary` MUI blue (#1976D2) while
    // the live site painted Aglyn cyan (#00b0ff): the editor disagreed with
    // what it was supposedly previewing, which is the one thing it must not do.
    const themeOptions = mergeThemeOptions(
      (scheme === 'dark' ? consoleOptionsDark : consoleOptions) ?? {},
      hostThemeToThemeOptions(hostTheme, scheme),
    )
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
          // Spread the existing entry per component: now that the brand base
          // is merged in, replacing these wholesale would drop any
          // `styleOverrides` it ships for them. Only `defaultProps.container`
          // is ours to set — it points MUI's portals at the canvas container.
          MuiPopover: {
            ...themeOptions.components?.MuiPopover,
            defaultProps: {
              ...themeOptions.components?.MuiPopover?.defaultProps,
              container: container,
            },
          },
          MuiPopper: {
            ...themeOptions.components?.MuiPopper,
            defaultProps: {
              ...themeOptions.components?.MuiPopper?.defaultProps,
              container: container,
            },
          },
          MuiModal: {
            ...themeOptions.components?.MuiModal,
            defaultProps: {
              ...themeOptions.components?.MuiModal?.defaultProps,
              container: container,
            },
          },
        },
      },
    })
  }, [container, hostTheme, scheme])
}
export default useAglynSiteTheme
