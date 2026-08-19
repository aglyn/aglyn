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
// exactly the components it renders.
import AppLink from '@aglyn/shared-ui-jsx/components/app-link'
import { Container } from '@aglyn/shared-ui-jsx/components/container'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useHostBrand } from '../app/[host]/host-brand.context'

export interface SiteStatusScreenProps {
  /** Status code, rendered as the eyebrow — `'404'`, `'500'`. */
  code: string
  title: string
  message: string
  /** Extra actions rendered before the always-present "home" link. */
  action?: ReactNode
  /**
   * Render the site-search form in the body.
   *
   * Set by the 404 and deliberately NOT by the 500: search is the right answer
   * to "the page I wanted has moved", and the wrong one to "this site is
   * currently throwing" — the search page is served by the same runtime that
   * just failed, so offering it there is offering a second error. An explicit
   * prop rather than a branch on `code`, so the boundary that knows which
   * situation it is in is the thing that decides.
   */
  search?: boolean
}

/**
 * The tenant's LAST-RESORT status page (AGL-2074, navigation in AGL-2187).
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
 * already applied the host's colors and fonts), and gives the visitor real
 * places to go.
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
 * ## Navigation (AGL-2187)
 *
 * Zach, on the live 404: *"there is no ability to navigate away that is
 * horrible UX"*. He is right, and the previous version of this file answered
 * him by pointing at the designed-screen path — true, and no help at all to a
 * visitor on one of the sites that has designated nothing.
 *
 * What this can and cannot offer is decided by where the data lives:
 *
 *  - **The site's real nav and footer cannot be rendered here.** They are
 *    besigner nodes inside each screen's composed content (`muiNavMenu` takes
 *    its items as child nodes), and the screen that holds them is the one that
 *    was not found. There is no host-level menu document to read. A "nav" that
 *    rendered an empty bar would be worse than none.
 *  - **The site's public top-level pages CAN be.** They come from the host's
 *    routing map, resolved in `[host]/layout` and published through
 *    `HostBrandProvider` — filtered to PUBLIC screens, because that map also
 *    holds unlisted, members-only and password-protected pages. See
 *    `utils/site-nav.ts`; that filter is a security boundary, not a nicety.
 *  - **`/search` always exists** (`app/[host]/search/page.tsx` is a real route
 *    on every tenant host), so the 404 can offer to find the page rather than
 *    only to leave.
 *
 * A site with no other public top-level page still gets a header with its
 * mark, a search box and a footer — every element is dropped rather than
 * rendered empty when its data is absent, so there is no branch of this that
 * shows a visitor an empty container.
 */
export function SiteStatusScreen(props: SiteStatusScreenProps) {
  const { code, title, message, action, search } = props
  const { brandName, brandLogoUrl, siteLinks } = useHostBrand()
  const links = siteLinks ?? []
  const hasMark = Boolean(brandLogoUrl || brandName)

  /* The mark doubles as the navigation home — the one destination a tenant
     site always has. Rendered only when the site gave us one. */
  const mark = hasMark ? (
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
  ) : null

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* The header is dropped entirely for a site with neither a mark nor a
          public top-level page — an empty bar above an error is chrome for
          chrome's sake, and the footer below still carries a way out. */}
      {hasMark || links.length > 0 ? (
        <Box
          component="header"
          sx={{ borderBottom: 1, borderColor: 'divider', py: 2 }}
        >
          <Container
            maxWidth="lg"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: hasMark ? 'space-between' : 'center',
              flexWrap: 'wrap',
              gap: 2,
            }}
          >
            {mark}
            {links.length > 0 ? (
              <Stack
                component="nav"
                aria-label="Site"
                direction="row"
                sx={{
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  columnGap: 3,
                  rowGap: 1,
                }}
              >
                {links.map((link) => (
                  <AppLink
                    key={link.href}
                    componentVariant="text"
                    href={link.href}
                    underline="hover"
                    color="text.primary"
                    variant="body2"
                  >
                    {link.label}
                  </AppLink>
                ))}
              </Stack>
            ) : null}
          </Container>
        </Box>
      ) : null}

      <Container
        maxWidth="sm"
        gutterY
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 3,
        }}
      >
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

        {/* A plain GET form, no `onSubmit` and no router: it posts straight to
            `/search?q=…` as a document navigation, so it works with JavaScript
            broken — which is one of the ways a visitor arrives here. */}
        {search ? (
          <Stack
            component="form"
            action="/search"
            method="get"
            role="search"
            direction="row"
            spacing={1}
            sx={{ width: '100%', maxWidth: 420 }}
          >
            <TextField
              name="q"
              type="search"
              size="small"
              fullWidth
              label="Search this site"
            />
            <Button type="submit" variant="outlined">
              {'Search'}
            </Button>
          </Stack>
        ) : null}

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

      {/* Always rendered, because unlike the header it always has something in
          it: home is a destination every tenant site has, and `/search` is a
          real route on every one of them. */}
      <Box
        component="footer"
        sx={{ borderTop: 1, borderColor: 'divider', py: 3 }}
      >
        <Container
          maxWidth="lg"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            columnGap: 3,
            rowGap: 1,
          }}
        >
          <AppLink
            componentVariant="text"
            href="/"
            underline="hover"
            color="text.secondary"
            variant="body2"
          >
            {'Home'}
          </AppLink>
          {links.map((link) => (
            <AppLink
              key={link.href}
              componentVariant="text"
              href={link.href}
              underline="hover"
              color="text.secondary"
              variant="body2"
            >
              {link.label}
            </AppLink>
          ))}
          <AppLink
            componentVariant="text"
            href="/search"
            underline="hover"
            color="text.secondary"
            variant="body2"
          >
            {'Search'}
          </AppLink>
        </Container>
      </Box>
    </Box>
  )
}
SiteStatusScreen.displayName = 'SiteStatusScreen'

export default SiteStatusScreen
