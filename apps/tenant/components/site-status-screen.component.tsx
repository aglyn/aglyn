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

// Deep imports, not the barrel. `@aglyn/shared-ui-jsx`'s index warns that
// everything re-exported there ships eagerly on EVERY published customer
// page; this component is on the cold path of every site, so it pays for
// exactly the two components it renders.
import AppLink from '@aglyn/shared-ui-jsx/components/app-link'
import { Container } from '@aglyn/shared-ui-jsx/components/container'
import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useHostBrand } from '../app/[host]/host-brand.context'

export interface SiteStatusScreenProps {
  /** Status code, rendered as the eyebrow — `'404'`, `'500'`. */
  code: string
  title: string
  message: string
  /** Extra actions rendered before the always-present "home" link. */
  action?: ReactNode
}

/**
 * The tenant's LAST-RESORT status page (AGL-2074).
 *
 * ## What it is for
 *
 * A host can designate a designed screen per status code
 * (`host.errorScreens`, AGL-131) and that screen — with the site's real
 * header, nav and footer — is what a visitor should see. This renders only
 * when the host designated NOTHING, which until now meant Next's own
 * `404 | This page could not be found`: no brand, no navigation, no way back.
 * Measured on 2026-08-18, `errorScreens` was unset on 6 of 6 hosts in
 * production, so that framework page was the live behaviour of every site on
 * the platform, aglyn.com included.
 *
 * So the bar here is not "as good as a designed screen" — it is "never a
 * framework default again". It carries the site's mark, sits under the site's
 * own theme (it renders inside `[host]/layout`, so `HostThemeProvider` has
 * already applied the host's colors and fonts), and always offers a way home.
 *
 * ## Why it names no platform
 *
 * There is deliberately no "Aglyn", no logo fallback to ours, and no "powered
 * by" line. This surface serves WHITE-LABELLED customer sites — an agency on
 * the `whiteLabel` entitlement resells these domains as its own, and AGL-1354
 * is the record of how carefully that boundary has to be held. A boundary
 * that helpfully substitutes the platform's mark when a host has no logo
 * would put OUR brand on THEIR client's site at precisely the moment
 * something went wrong.
 *
 * The rule that makes this safe without needing an entitlement lookup (which
 * a boundary cannot do — see `host-brand.context.tsx` on why there is no host
 * fetch here): name nobody but the site itself. With a logo, show the logo;
 * with only a name, show the name; with neither, show nothing. Every branch
 * is correct for a white-label site because no branch mentions a third party.
 *
 * ## Navigation
 *
 * The site's real nav lives in the composed page nodes and is not reachable
 * from a boundary that has no host data. What IS always true of a tenant site
 * is that `/` is its home, so the mark links there and an explicit action
 * repeats it — Zach's "included navs" is properly answered by ASSIGNING a
 * designed screen, which this exists to make unnecessary to rely on.
 */
export function SiteStatusScreen(props: SiteStatusScreenProps) {
  const { code, title, message, action } = props
  const { brandName, brandLogoUrl } = useHostBrand()

  return (
    <Container
      maxWidth="sm"
      gutterY
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 3,
      }}
    >
      {/* The mark doubles as the navigation home — the one destination a
          tenant site always has. Rendered only when the site gave us one. */}
      {brandLogoUrl || brandName ? (
        <AppLink
          componentVariant="text"
          href="/"
          underline="none"
          color="text.primary"
          aria-label={brandName ? `${brandName} home` : 'Home'}
          sx={{ display: 'inline-flex', alignItems: 'center' }}
        >
          {brandLogoUrl ? (
            <Box
              component="img"
              src={brandLogoUrl}
              alt={brandName ?? ''}
              // An EXPLICIT height, not `maxHeight` + `width: 'auto'`
              // (AGL-2074). Measured in a real browser on the marketing host:
              // the max-only form laid the logo out at 0x0 — present in the
              // DOM, `complete`, `naturalWidth` 300, and invisible — so the
              // 404 rendered with no mark at all and looked correct in the
              // markup. Setting the height and letting the width follow gave
              // 145x44. `display: block` keeps it off the anchor's line box.
              sx={{
                display: 'block',
                height: 44,
                width: 'auto',
                maxWidth: 220,
                objectFit: 'contain',
              }}
            />
          ) : (
            <Typography variant="h6" component="span">
              {brandName}
            </Typography>
          )}
        </AppLink>
      ) : null}

      <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography
          variant="overline"
          component="p"
          color="text.secondary"
          sx={{ letterSpacing: '0.2em' }}
        >
          {code}
        </Typography>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {message}
        </Typography>
      </Stack>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: 'center' }}
      >
        {action}
        <AppLink componentVariant="button" variant="contained" href="/">
          {'Go to the homepage'}
        </AppLink>
      </Stack>
    </Container>
  )
}
SiteStatusScreen.displayName = 'SiteStatusScreen'

export default SiteStatusScreen
