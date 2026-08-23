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
import { renameTitleSubject } from '../app/entity-page-title'
import { stripUnreadBadge } from '../utils/notification-alerts'
import { useDocumentSubject } from './document-subject'

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
  // WHICH entity the route is about (AGL-2486), published by the page. Read
  // HERE, rather than written by the page, because this component owns
  // `document.title` — see the tab-title effect below.
  const subject = useDocumentSubject()
  const subjectId = subject?.id ?? null
  const subjectName = subject?.name ?? null

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
  //
  // AGL-2486 added the SECOND rewrite this effect performs — swapping the
  // entity id the server put at the front of the title for the display name
  // the client has loaded — and it lands here, in the existing observer,
  // rather than in a component of its own. That is the entire design
  // constraint: two writers both re-asserting a title against a
  // MutationObserver is not a race that can be won, it is a loop. There is
  // ONE owner, and it applies BOTH transforms in one pass, so the tab never
  // shows a half-transformed state.
  //
  // Order matters and is fixed: subject first, brand second. The subject
  // rewrite is anchored to the START of the title and the brand rewrite acts
  // on the END, so they do not overlap; doing the brand first would still be
  // correct but would rewrite a longer string for no reason.
  useEffect(() => {
    // Renaming to the name it already has is not a rename, and attempting it
    // would make every replacement a fixed point we cannot tell from a loop.
    const rebranding = !!productName && productName !== PLATFORM_BRAND_NAME
    const naming = !!subjectId && !!subjectName
    if (!rebranding && !naming) return
    /** Both rewrites, composed. Idempotent — see the note on termination. */
    const transform = (title: string) => {
      // The unread badge is stripped off the FRONT before the subject is
      // matched, and put back after. `notifications-menu.component.tsx`
      // prepends `(3) ` to the tab under its own MutationObserver, so the
      // served title reaching us is `(3) 4L_o499p_p · Screen besigner · …`
      // and a subject rewrite anchored at position 0 silently matches
      // nothing. That is not hypothetical: it is what this did on localhost
      // before the strip was added, with every tab stuck on the id.
      //
      // Through the shared `stripUnreadBadge` — the same inverse the badge
      // writer and the GA4 title builder use — rather than a third copy of
      // the pattern, for the reason AGL-2060 records: a drifted copy starts
      // leaking silently.
      const base = naming ? stripUnreadBadge(title) : title
      const badge = naming ? title.slice(0, title.length - base.length) : ''
      const named = naming
        ? badge + renameTitleSubject(base, subjectId, subjectName)
        : title
      return rebranding && named.includes(PLATFORM_BRAND_NAME)
        ? named.split(PLATFORM_BRAND_NAME).join(productName)
        : named
    }
    /** The last value WE wrote — so an unrelated title change is not ours. */
    let applied: string | null = null
    /** What it read before we wrote, so cleanup restores rather than guesses. */
    let original: string | null = null
    const apply = () => {
      const current = document.title
      if (applied !== null && current === applied) return
      const next = transform(current)
      // Nothing to do is the common case — most titles carry no subject id,
      // and a non-white-label org reaches here only for the subject rewrite.
      if (next === current) return
      original = current
      applied = next
      document.title = next
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
  }, [productName, subjectId, subjectName])

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
