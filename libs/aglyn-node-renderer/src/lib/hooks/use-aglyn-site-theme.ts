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
  createSiteSchemeThemes,
  hostThemeToThemeOptions,
  mergeThemeOptions,
  type SiteSchemeThemes,
  siteBaseOptions,
  type Theme,
  useHostSiteKey,
} from '@aglyn/shared-ui-theme'
import { useMemo } from 'react'

export type UseAglynSiteThemeOptions = {
  // Node covers ShadowRoot containers, which MUI accepts at runtime but
  // types as Element only.
  container?: Element | Node
  /** Persisted host theme customization; omitted → default light theme (legacy behavior). */
  theme?: HostTheme
  scheme?: HostThemeScheme
  /**
   * Which site this is — its attached domain, or its subdomain (AGL-3068).
   *
   * It decides the BASE the site's overrides are layered onto, which is the
   * one thing the editor cannot derive from the theme document: the operator's
   * own hosts keep the platform brand, every customer site resolves the
   * neutral tenant default, and the published page has already made that
   * choice from its own address. Unnamed resolves what a customer site
   * resolves.
   *
   * `useAglynSiteTheme` falls back to `HostSiteKeyContext`, so a surface
   * inside the console's host routes needs to pass nothing.
   */
  host?: string
}

/**
 * The theme a site renders with on the canvas and in Preview: the host's
 * overrides layered onto the base that site publishes on, with MUI's portals
 * pointed at the container. {@link useAglynSiteTheme} memoizes it; anything
 * that renders a site outside React's hooks — the AI plugin's device-width
 * audit of its golden pages (AGL-3020) — builds the same theme here.
 */
export function createAglynSiteTheme(options: UseAglynSiteThemeOptions = {}) {
  const container = options.container as Element | undefined
  const hostTheme = options.theme
  const scheme = options.scheme ?? 'light'
  // Layer the host's overrides onto the base the PUBLISHED PAGE uses, chosen
  // from the same site key the tenant chooses from (AGL-1180/AGL-1205,
  // AGL-3068). `hostThemeToThemeOptions` emits only what the host explicitly
  // set, so building from it alone leaves every untouched slot on MUI's stock
  // palette — and a site that keeps its theme all-`Default` has nothing else.
  // Which base is not a constant: the operator's own hosts wear the platform
  // brand and a customer site wears the neutral tenant default, so a canvas
  // that always took the brand painted Aglyn cyan over a site that publishes
  // in blue, including its contrast.
  const themeOptions = mergeThemeOptions(
    siteBaseOptions(options.host, scheme),
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
}

export function useAglynSiteTheme(options: UseAglynSiteThemeOptions = {}) {
  const container = options.container
  const hostTheme = options.theme
  const scheme = options.scheme ?? 'light'
  // The surface names its site, or the route it is on does. Every besigner
  // panel and preview reads the same context, so the base is decided once per
  // editor rather than per component.
  const contextHost = useHostSiteKey()
  const host = options.host ?? contextHost

  return useMemo(
    () => createAglynSiteTheme({ container, theme: hostTheme, scheme, host }),
    [container, hostTheme, scheme, host],
  )
}
/**
 * The site's theme for EITHER scheme, for `SiteSchemeThemesContext`
 * (AGL-3284) — what an "Always light" / "Always dark" element renders under on
 * the canvas and in Preview.
 *
 * Built by {@link createAglynSiteTheme} from the same inputs
 * {@link useAglynSiteTheme} takes, so a pinned band on the canvas wears
 * exactly what the published page's `HostThemeProvider` would give it.
 * `active` is the theme the surface is already rendering; it is answered for
 * its own scheme rather than rebuilt, so a surface that has pinned or patched
 * its theme (the canvas's device width) keeps that for the matching scheme.
 * `finish` applies the same patch to the other scheme's theme; memoize it, as
 * the getter is rebuilt when it changes.
 */
export function useAglynSiteSchemeThemes(
  options: Omit<UseAglynSiteThemeOptions, 'scheme'> & {
    active: Theme
    finish?: (theme: Theme) => Theme
  },
): SiteSchemeThemes {
  const { container, theme: hostTheme, active, finish } = options
  const contextHost = useHostSiteKey()
  const host = options.host ?? contextHost
  return useMemo(
    () =>
      createSiteSchemeThemes((scheme) => {
        if ((active.palette?.mode === 'dark' ? 'dark' : 'light') === scheme)
          return active
        const built = createAglynSiteTheme({
          container,
          theme: hostTheme,
          scheme,
          host,
        })
        return finish ? finish(built) : built
      }),
    [active, finish, container, hostTheme, host],
  )
}

export default useAglynSiteTheme
