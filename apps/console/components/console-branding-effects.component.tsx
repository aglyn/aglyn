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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { darken, lighten } from '@mui/material/styles'
import { useEffect } from 'react'
import useBranding from '../hooks/use-branding'

/**
 * Applies the current org's white-label brand to the three console-chrome
 * surfaces the React tree can't reach declaratively (White-Label Phase 2):
 * the browser favicon, the MUI primary color, and the browser TAB TITLE. All
 * read the ONE shared `resolveBrandingProfile` (via `useBranding`) so they
 * never drift from the app-bar logo, the published site, or transactional
 * email.
 *
 * Renders nothing. Only acts when the org is white-label entitled AND set the
 * field; otherwise it leaves — and, on cleanup or downgrade, restores — the
 * platform defaults baked into the static theme and the root `<head>`.
 */
export function ConsoleBrandingEffects(): null {
  const { branding, whiteLabel } = useBranding()
  const primaryColor = whiteLabel ? branding.primaryColor : null
  const faviconUrl = whiteLabel ? branding.faviconUrl : null
  const productName = whiteLabel ? branding.productName : null

  // Primary color: the console theme is a static CSS-var theme, so a per-org
  // color is applied by overriding the MUI primary custom properties inline on
  // <html>. Inline wins over both the `:root` (light) and `.dark` rules, so one
  // brand color covers both schemes; derived dark/light/contrast shades are
  // recomputed with MUI's own helpers so hover/disabled states stay coherent.
  useEffect(() => {
    if (!primaryColor) return
    const root = document.documentElement
    const channel = hexToChannel(primaryColor)
    const vars: Record<string, string> = {
      '--mui-palette-primary-main': primaryColor,
      '--mui-palette-primary-dark': darken(primaryColor, 0.2),
      '--mui-palette-primary-light': lighten(primaryColor, 0.2),
      '--mui-palette-primary-contrastText': readableText(primaryColor),
    }
    if (channel) vars['--mui-palette-primary-mainChannel'] = channel
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value)
    }
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name)
    }
  }, [primaryColor])

  // Favicon: swap the <link rel="icon"> href to the brand favicon, restoring
  // the original hrefs on cleanup so a downgrade reverts to the Aglyn icons.
  useEffect(() => {
    if (!faviconUrl) return
    const links = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    )
    const previous = links.map((link) => link.getAttribute('href'))
    if (links.length) {
      for (const link of links) link.setAttribute('href', faviconUrl)
    } else {
      const link = document.createElement('link')
      link.rel = 'icon'
      link.href = faviconUrl
      link.dataset.brandingInjected = 'true'
      document.head.appendChild(link)
      return () => {
        link.remove()
      }
    }
    return () => {
      links.forEach((link, index) => {
        const href = previous[index]
        if (href == null) link.removeAttribute('href')
        else link.setAttribute('href', href)
      })
    }
  }, [faviconUrl])

  // Tab title. The console title is server-rendered from `TITLE_TEMPLATE`
  // ("%s · Aglyn") and the root layout's `title.default`, both built from
  // `PLATFORM_BRAND_NAME` — the DEPLOYMENT brand. AGL-2170 made that follow a
  // self-hoster's env var, which is a different question from the one
  // white-label asks: a per-ORG brand cannot be baked at build time, so every
  // browser tab in a white-label org's console still read "· Aglyn" while the
  // favicon beside it had already been replaced above. A half-branded tab is
  // exactly the state `white-label.md` promises does not exist ("no flash of
  // one brand turning into the other"), and it is the most-looked-at chrome
  // in the product.
  //
  // Done as a `<head>` MutationObserver rather than a one-shot write because
  // Next re-renders `<title>` on every client navigation, which would undo a
  // single assignment on the first link click. Observing the head catches both
  // a text mutation and a wholesale element swap.
  //
  // The loop this could obviously become is closed by the replacement itself:
  // after a rewrite the title no longer CONTAINS `PLATFORM_BRAND_NAME`, so the
  // observer's re-entry is a no-op. The `applied` check is the belt to that
  // braces — it also makes an org whose productName happens to contain the
  // platform name terminate rather than grow.
  useEffect(() => {
    // Renaming to the name it already has is not a rename, and attempting it
    // would make every replacement a fixed point we cannot tell from a loop.
    if (!productName || productName === PLATFORM_BRAND_NAME) return
    /** The last value WE wrote — so an unrelated title change is not ours. */
    let applied: string | null = null
    /** What it read before we wrote, so cleanup restores rather than guesses. */
    let original: string | null = null
    const apply = () => {
      const current = document.title
      if (applied !== null && current === applied) return
      if (!current.includes(PLATFORM_BRAND_NAME)) return
      original = current
      applied = current.split(PLATFORM_BRAND_NAME).join(productName)
      document.title = applied
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    return () => {
      observer.disconnect()
      // Only put back a title we are still the author of. If something else
      // has since set the tab, restoring our stale value would be the bug.
      if (applied !== null && original !== null && document.title === applied) {
        document.title = original
      }
    }
  }, [productName])

  return null
}

/** `#rgb`/`#rrggbb` → the `"r g b"` channel MUI alpha overlays consume; else null. */
function hexToChannel(color: string): string | null {
  const hex = color.trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

/** Black or white, whichever reads on the brand color (WCAG relative luminance). */
function readableText(color: string): string {
  const channel = hexToChannel(color)
  if (!channel) return '#ffffff'
  const [r, g, b] = channel.split(' ').map(Number)
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

export default ConsoleBrandingEffects
