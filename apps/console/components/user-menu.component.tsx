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

import {
  ICON_VARIANT_SIGN_OUT,
  ICON_VARIANT_SYMBOL_SECURE,
  ICON_VARIANT_THEME_DARK,
  ICON_VARIANT_THEME_LIGHT,
  ICON_VARIANT_THEME_SYSTEM,
  ICON_VARIANT_USER_SETTINGS,
} from '@aglyn/shared-data-enums'
import {
  mdiAccountGroupOutline,
  mdiBookOpenVariant,
  mdiCreditCardOutline,
  mdiLifebuoy,
  mdiOpenInNew,
} from '@aglyn/shared-data-mdi'
import { isEnterpriseOrg, PLAN_LABELS, type OrgPlan } from '@aglyn/aglyn'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useUser, useUserPhoto } from '@aglyn/tenant-feature-instance'
import {
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemButton,
  ListItemText,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import { type ReactNode, useState } from 'react'
import { buildDocsUrl } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentOrg from '../hooks/use-current-org'
import { useIsStaff } from '../hooks/use-is-staff'
import { useOrgReach } from '../hooks/use-org-reach'
import { useOrgScope, useOrgSlug } from '../hooks/use-org-scope'
import { useUrlNamesOrg } from '../hooks/use-secondary-nav'

/**
 * Plans with nothing above them to sell (org-billing.types): `agency` tops the
 * self-serve ladder since pricing v3, and `enterprise` sits off it entirely
 * (custom-priced, AGL-1118). Pitching either an upgrade is nonsense — this
 * used to name only `advanced`, so both saw the CTA.
 */
const TOP_PLANS: ReadonlySet<string> = new Set(['agency', 'enterprise'])

/**
 * The account menu in the top bar (AGL-858), redesigned after Vercel's:
 * an identity header with a settings gear, right-aligned row icons, an inline
 * light/system/dark theme toggle (moved out of the top bar), an Upgrade CTA
 * that only shows below the top plan, and a footer naming the workspace the
 * org-scoped links act on. Self-contained — reads its own user/org/theme.
 */
export function UserMenu() {
  const { data: user } = useUser()
  const userPhotoUrl = useUserPhoto({ gravatar: { size: '64' } })
  // Only a URL that names a workspace lets this menu name one (AGL-1130).
  // `useOrgSlug()` falls back to the user's first org so that org-less pages
  // still have somewhere to act; the footer and the Upgrade CTA are CLAIMS
  // about the workspace you are in, and in the staff console or Manage
  // Account they claimed one picked by a fallback. Blanked here, the org rows
  // fall to the jump page on their own — the same path they already took
  // before an org resolved — so they stay usable without asserting which
  // workspace they mean.
  const namesOrg = useUrlNamesOrg()
  const resolvedOrgSlug = useOrgSlug()
  const orgSlug = namesOrg ? resolvedOrgSlug : ''
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const isStaff = useIsStaff()
  // Team / Billing / Support are org pages (AGL-1032). This menu is org nav
  // as much as the tab strip is — leaving the rows here would send a site
  // collaborator to a page the guard immediately bounces them off.
  const { orgWide, ready: reachReady } = useOrgReach()
  // …and a page that names no workspace has no org for them to act on. AGL-1130
  // blanked `orgSlug` here so these rows stopped CLAIMING a workspace picked by
  // a fallback, but it left them rendered and pointing at the jump page — so on
  // the workspace chooser, Manage Account and the staff console, "Manage Team"
  // and "Billing" were live rows that just bounced you to `/`. A row that
  // cannot do what it says should not be offered; hidden here, and the
  // account-scoped rows below cover what those pages can actually reach.
  const showOrgLinks = namesOrg && (!reachReady || orgWide)
  const { mode, setMode } = useColorScheme()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const close = () => setAnchorEl(null)
  const orgHome = orgSlug ? buildRoute(Route.ORG_HOME, { orgSlug }) : '/'
  // Org-scoped destinations fall back to the jump page before an org resolves,
  // exactly like the Billing link did in the old menu.
  const orgLink = (
    route: Route.MANAGE_TEAM | Route.MANAGE_BILLING | Route.MANAGE_SUPPORT,
  ) => (orgSlug ? buildRoute(route, { orgSlug }) : orgHome)

  const name = user?.displayName || user?.email || 'Account'
  const email = user?.email ?? ''
  const plan = org?.plan
  const planLabel = isEnterpriseOrg(org)
    ? PLAN_LABELS.enterprise
    : plan
      ? (PLAN_LABELS[plan as OrgPlan] ?? '')
      : ''
  // Only pitch an upgrade once the org doc has resolved (AGL-887) — while
  // it's loading (or the read failed) `plan` is undefined, which would show
  // the CTA to a top-plan workspace.
  // …and a collaborator cannot buy anything either — the CTA lands on the
  // Billing page they may not open (AGL-1032).
  // …and an org already reading as Enterprise (custom-priced or comped off a
  // lower base plan, AGL-1110) has nothing to buy either.
  const showUpgrade =
    Boolean(orgSlug) &&
    orgReady &&
    !TOP_PLANS.has(String(plan)) &&
    !isEnterpriseOrg(org) &&
    showOrgLinks

  const themeValue = mode ?? 'system'

  const row = (
    href: string,
    label: string,
    iconPath: string,
    opts?: { external?: boolean },
  ): ReactNode => (
    // ListItemButton, not MenuItem: these rows live in a Popover, and MUI's
    // MenuItem throws without a MenuList/Menu context around it (AGL-858).
    <ListItemButton
      component={opts?.external ? 'a' : AppLink}
      href={href}
      onClick={close}
      {...(opts?.external
        ? { target: '_blank', rel: 'noopener noreferrer' }
        : {})}
      sx={{ gap: 2, py: 0.75 }}
    >
      <ListItemText
        slotProps={{ primary: { variant: 'body2' } }}
        sx={{ my: 0 }}
      >
        {label}
      </ListItemText>
      <MdiIcon path={iconPath} fontSize="small" sx={{ color: 'text.secondary' }} />
    </ListItemButton>
  )

  return (
    <>
      <Tooltip title="Manage account">
        <IconButton
          onClick={(event) => setAnchorEl(event.currentTarget)}
          edge="end"
          aria-label="Manage account"
          aria-haspopup="menu"
          sx={{ p: 0.5 }}
        >
          <Avatar
            src={userPhotoUrl}
            slotProps={{ img: { referrerPolicy: 'no-referrer' } }}
            sx={{ width: 30, height: 30 }}
          >
            {name.slice(0, 1).toUpperCase()}
          </Avatar>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              width: 300,
              mt: 0.75,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              backgroundColor: 'surface.main',
              backgroundImage: 'none',
              boxShadow: '0px 8px 24px rgba(0,0,0,0.18)',
              overflow: 'hidden',
            },
          },
        }}
      >
        {/* Identity header + settings gear → Manage Account. */}
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Avatar
            src={userPhotoUrl}
            slotProps={{ img: { referrerPolicy: 'no-referrer' } }}
            sx={{ width: 36, height: 36 }}
          >
            {name.slice(0, 1).toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {name}
            </Typography>
            {email ? (
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {email}
              </Typography>
            ) : null}
          </Box>
          <Tooltip title="Manage Account">
            <IconButton
              size="small"
              component={AppLink}
              href={Route.MANAGE_USER_SETTINGS}
              onClick={close}
              aria-label="Manage Account"
            >
              <MdiIcon path={ICON_VARIANT_USER_SETTINGS.path} fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />

        {/* Account-scoped, so it works from ANY page including the org-less
            ones where every row below is hidden — otherwise the workspace
            chooser and the staff console offer nothing but Documentation and
            Sign out. The header gear already links here; this is the same
            destination as a labelled row, because a gear is not discoverable
            as "Manage account". */}
        {row(
          Route.MANAGE_USER_SETTINGS,
          'Manage account',
          ICON_VARIANT_USER_SETTINGS.path,
        )}
        {showOrgLinks ? (
          <>
            {row(orgLink(Route.MANAGE_TEAM), 'Manage Team', mdiAccountGroupOutline.path)}
            {row(orgLink(Route.MANAGE_BILLING), 'Billing', mdiCreditCardOutline.path)}
            {row(orgLink(Route.MANAGE_SUPPORT), 'Support', mdiLifebuoy.path)}
          </>
        ) : null}
        {isStaff
          ? row(Route.ADMIN_OVERVIEW, 'Staff console', ICON_VARIANT_SYMBOL_SECURE.path)
          : null}
        {row(buildDocsUrl(), 'Documentation', mdiOpenInNew.path, { external: true })}

        {/* Inline theme toggle (moved out of the top bar). */}
        <Box
          sx={{
            px: 2,
            py: 0.75,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            {'Theme'}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={themeValue}
            onChange={(_event, value) => {
              if (value) setMode(value)
            }}
            aria-label="theme mode"
          >
            <ToggleButton value="light" aria-label="light" sx={{ px: 1, py: 0.25 }}>
              <MdiIcon path={ICON_VARIANT_THEME_LIGHT.path} fontSize="small" />
            </ToggleButton>
            <ToggleButton value="system" aria-label="system" sx={{ px: 1, py: 0.25 }}>
              <MdiIcon path={ICON_VARIANT_THEME_SYSTEM.path} fontSize="small" />
            </ToggleButton>
            <ToggleButton value="dark" aria-label="dark" sx={{ px: 1, py: 0.25 }}>
              <MdiIcon path={ICON_VARIANT_THEME_DARK.path} fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {showUpgrade ? (
          <Box sx={{ px: 1.5, py: 1 }}>
            <Button
              fullWidth
              variant="contained"
              component={AppLink}
              href={orgLink(Route.MANAGE_BILLING)}
              onClick={close}
              sx={{
                bgcolor: 'text.primary',
                color: 'background.paper',
                '&:hover': { bgcolor: 'text.secondary' },
              }}
            >
              {'Upgrade plan'}
            </Button>
          </Box>
        ) : null}

        <Divider />
        {row(Route.AUTH_SIGN_OUT, 'Sign out', ICON_VARIANT_SIGN_OUT.path)}

        {namesOrg && currentOrg?.orgName ? (
          <Box
            sx={{
              px: 2,
              py: 1,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {currentOrg.orgName}
              {/* One label source (AGL-1118) — a `plan: 'enterprise'` org
                  reads "Enterprise plan" here without a special case, and a
                  legacy custom-priced org is relabelled the same way. */}
              {planLabel ? ` · ${planLabel} plan` : ''}
            </Typography>
          </Box>
        ) : null}
      </Popover>
    </>
  )
}
UserMenu.displayName = 'UserMenu'
UserMenu.aglyn = true

export default UserMenu
