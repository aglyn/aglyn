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
 * The status page for boundaries that render ABOVE the host providers
 * (AGL-2074) — `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`.
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
 * Dark mode comes from `color-scheme` plus `currentColor`-relative values
 * rather than a media query per rule, so the page follows the visitor's OS
 * preference without a stylesheet or a hydration-sensitive class.
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
export function PlainStatusScreen({
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
            border: '1px solid currentColor',
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
PlainStatusScreen.displayName = 'PlainStatusScreen'

export default PlainStatusScreen
