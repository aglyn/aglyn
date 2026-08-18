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

import type { ReactNode } from 'react'

/**
 * The status page for App Router boundaries that render ABOVE every provider
 * (AGL-2074) — the tenant's and the console's `app/error.tsx`,
 * `app/global-error.tsx` and root `app/not-found.tsx`.
 *
 * Shared rather than duplicated per app, and deliberately NOT re-exported
 * from the barrel: this lib's index warns that everything it re-exports ships
 * eagerly on EVERY published customer page, and this component is on the cold
 * path of both apps. Both callers deep-import it.
 *
 * ## Why it uses no MUI and no theme
 *
 * These three boundaries sit outside `[host]/layout`, so there is no
 * `HostThemeProvider`, no resolved host, and — for `global-error`, which
 * REPLACES the root layout — no emotion cache either. A component that
 * reaches for `theme.palette` renders MUI's factory blue-and-white on a
 * customer's site, and one that reaches for emotion in `global-error` renders
 * unstyled. So this is plain elements and inline styles: the one thing every
 * one of those boundaries can definitely paint.
 *
 * ## Dark mode needs a real stylesheet here
 *
 * The first cut set `color-scheme: light dark` on the wrapper and leaned on
 * inherited colors. Measured in a dark-scheme browser: **black text on the
 * browser's black canvas**, completely unreadable. `color-scheme` changes the
 * UA's default colors for the ROOT element, and a `<div>` deep in the page
 * cannot claim the canvas — meanwhile `color` stayed at its initial black. A
 * status page that is invisible in dark mode is a worse failure than the
 * framework page it replaces, and it is invisible to markup review.
 *
 * So the colors are declared, in an inline `<style>` with a
 * `prefers-color-scheme` block, scoped to one class. A stylesheet rather than
 * inline style attributes because a media query cannot live in `style=`, and
 * an inline `<style>` rather than emotion because `global-error` runs with no
 * emotion cache at all. No class toggling and no script, so nothing here can
 * mismatch between server and client.
 *
 * ## Why it names no platform
 *
 * Same rule as `site-status-screen.component.tsx`, and it binds harder here:
 * these boundaries fire precisely when host data is unavailable, so there is
 * nothing to distinguish a white-label agency site from our own. Naming
 * nobody is the only answer that is correct in every case. No Aglyn mark, no
 * "powered by", no support address that would identify the operator to a
 * visitor who was never told one exists.
 *
 * The copy is deliberately generic about the operator too ("this site"),
 * because on `global-error` we genuinely do not know whose site it is.
 */
const ROOT_CLASS = 'aglyn-status-screen'

/**
 * Light values on the bare class, dark values behind the media query — so a
 * browser that never evaluates the query still gets a fully specified page,
 * and one that does gets legible text on a dark ground.
 */
const STYLES = `
.${ROOT_CLASS} { background: #ffffff; color: #101114; }
.${ROOT_CLASS} a, .${ROOT_CLASS} button { border-color: rgba(16, 17, 20, 0.32); }
@media (prefers-color-scheme: dark) {
  .${ROOT_CLASS} { background: #101114; color: #f2f3f5; }
  .${ROOT_CLASS} a, .${ROOT_CLASS} button { border-color: rgba(242, 243, 245, 0.36); }
}
`

export function StatusScreenPlain({
  code,
  title,
  message,
  action,
}: {
  code: string
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div
      className={ROOT_CLASS}
      style={{
        colorScheme: 'light dark',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '2rem 1.25rem',
        textAlign: 'center',
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <p
        style={{
          margin: 0,
          fontSize: '0.75rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          opacity: 0.6,
        }}
      >
        {code}
      </p>
      <h1
        style={{
          margin: 0,
          fontSize: 'clamp(1.5rem, 4vw, 2rem)',
          fontWeight: 600,
        }}
      >
        {title}
      </h1>
      <p style={{ margin: 0, maxWidth: '38ch', lineHeight: 1.6, opacity: 0.75 }}>
        {message}
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          justifyContent: 'center',
          marginTop: '0.5rem',
        }}
      >
        {action}
        {/* A plain anchor, NOT `AppLink`/`next/link`. `global-error` replaces
            the root layout and can be reached with the router in an unusable
            state, and a client-side navigation that fails leaves the visitor
            on the same broken page with no feedback. A full document load
            always works. */}
        <a
          href="/"
          style={{
            display: 'inline-block',
            padding: '0.6rem 1.1rem',
            borderRadius: '0.5rem',
            borderStyle: 'solid',
            borderWidth: '1px',
            textDecoration: 'none',
            color: 'inherit',
            fontWeight: 500,
          }}
        >
          {'Go to the homepage'}
        </a>
      </div>
    </div>
  )
}
StatusScreenPlain.displayName = 'StatusScreenPlain'

export default StatusScreenPlain
