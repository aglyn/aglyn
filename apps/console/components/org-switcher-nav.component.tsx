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
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_ORGANIZATION,
  ICON_VARIANT_SYMBOL_CONFIRMED,
  ICON_VARIANT_SYMBOL_SECURE,
  ICON_VARIANT_USER_SETTINGS,
} from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState, type UIEvent } from 'react'
import { ENTERPRISE_PLAN_LABEL, isEnterpriseOrg } from '@aglyn/aglyn'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentOrg from '../hooks/use-current-org'
import { useOrgPlans } from '../hooks/use-org-plans'
import { useOrgScope } from '../hooks/use-org-scope'
import { resolveNavSection, urlNamesOrg } from '../hooks/use-secondary-nav'
import { useUrlNamedOrg } from '../hooks/use-url-names-org'
import CreateOrgDialog from './create-org-dialog.component'
import SwitcherSearchField from './switcher-search-field.component'

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

/**
 * How many rows' tier badges are read at a time (AGL-2336).
 *
 * The menu list is 280px tall and a row is ~48px, so about six rows are on
 * screen; this reveals a comfortable screenful and a bit, then grows as the
 * user scrolls. The number that matters is that it is a CONSTANT — the old
 * code read a plan doc for every membership the moment the menu opened, so a
 * 50-workspace agency paid 50 reads per open and the only thing holding the
 * bill down was the 50-membership cap itself. Bounding the fan-out here is
 * what lets `useOrgScope` page past 50 at all.
 */
export const PLAN_BADGE_PAGE = 12

const titleCase = (value?: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : ''

/**
 * Organization switcher (AGL-236/AGL-621; AGL-629 Vercel team-switcher UI).
 * The button shows the current workspace; the dropdown filters the user's
 * orgs, marks the current one with a check, and offers a create row.
 * Switching NAVIGATES to the other org's URL — the URL is the source of truth,
 * so there is no local selection to race and snap back (the old switch-bounce).
 * On the apex that is `/[orgSlug]/hosts`; on a workspace subdomain it is the
 * other org's subdomain (the session cookie signs it in silently).
 */
export function OrgSwitcherNav() {
  const { orgs, currentOrg, orgSlug, hasMoreOrgs, loadMoreOrgs } = useOrgScope()
  const pathname = usePathname()
  // The full current-org doc carries the logo (AGL-363) and plan for the badge.
  // The workspace the URL actually names, when that is the one that
  // resolved — the switcher may name THAT and nothing else (AGL-2486).
  const urlNamedOrg = useUrlNamedOrg()
  const { org, ready: orgReady } = useCurrentOrg()
  const logoUrl = (org as any)?.logoUrl as string | undefined
  const plan = (org as any)?.plan as string | undefined
  const router = useRouter()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  // How far down the list the user has actually looked (AGL-2336). Reads for
  // the tier badges follow the eye, not the membership count.
  const [revealed, setRevealed] = useState(PLAN_BADGE_PAGE)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return orgs
    return orgs.filter((item) =>
      [item.orgName, item.slug, item.$id].some((field) =>
        field?.toLowerCase().includes(needle),
      ),
    )
  }, [orgs, query])

  // Each org's billing tier for the row badges — read only while the menu is
  // open (AGL-631), and only for the rows revealed so far (AGL-2336). The
  // current org's plan comes straight from useCurrentOrg. Passing the whole
  // membership list here is what made the 50 cap load-bearing.
  const revealedIds = useMemo(
    () => filtered.slice(0, revealed).map((item) => item.$id),
    [filtered, revealed],
  )
  const plans = useOrgPlans(revealedIds, Boolean(anchor))

  // Scrolling to the end of the list reveals the next page of badges, and —
  // when the membership window itself is truncated — pulls the next page of
  // memberships in behind it.
  const onListScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 24) return
    setRevealed((count) =>
      count < filtered.length ? count + PLAN_BADGE_PAGE : count,
    )
    if (revealed >= filtered.length && hasMoreOrgs) loadMoreOrgs()
  }

  const close = () => {
    setAnchor(null)
    setQuery('')
    setRevealed(PLAN_BADGE_PAGE)
  }

  const switchTo = (item: (typeof orgs)[number]) => {
    close()
    if (item.$id === currentOrg?.$id || !item.slug) return
    const href = buildRoute(Route.HOST_LIST, { orgSlug: item.slug })
    // On a workspace subdomain the org IS the hostname, so switching means
    // moving to the other org's subdomain; on the apex it is a client
    // navigation. Either way the URL drives the scope.
    if (orgSlug) {
      window.location.assign(`https://${item.slug}.${WORKSPACE_DOMAIN}${href}`)
      return
    }
    router.push(href)
  }

  // Org-less sections (AGL-1119 for staff, AGL-1130 for the personal Manage
  // area): there is no org scope here, and with no `orgSlug` in the URL the
  // scope silently fell back to the user's FIRST org — so the page was
  // chromed "Aglyn LLC · Enterprise", claiming a workspace context it does
  // not have, plan badge and all. Name what the section actually is instead.
  //
  // Each links to its own TOP, not to a list: this sits where the workspace
  // chip sits, and that chip goes home. The wordmark-adjacent control is
  // "back to the top of where I am" — for the staff console that is its
  // overview (Organizations is one section of it, reachable from the tab
  // strip right below), and for Manage it is Manage Account.
  //
  // A specific org's staff detail page keeps this label too: it reaches this
  // component with no orgSlug, and the org's name is already the page's own
  // heading, breadcrumb and summary card.
  const section = resolveNavSection(pathname)
  if (section.kind === 'admin' || section.kind === 'manage') {
    const admin = section.kind === 'admin'
    return (
      <Button
        component={AppLink}
        href={buildRoute(
          admin ? Route.ADMIN_OVERVIEW : Route.MANAGE_USER_SETTINGS,
        )}
        color="inherit"
        startIcon={
          <MdiIcon
            path={
              admin
                ? ICON_VARIANT_SYMBOL_SECURE.path
                : ICON_VARIANT_USER_SETTINGS.path
            }
          />
        }
        sx={{ textTransform: 'none', fontWeight: 600 }}
      >
        {admin ? 'Staff Console' : 'Account'}
      </Button>
    )
  }

  // Any other route the URL doesn't scope to a workspace — the org jump page
  // at the apex, chiefly. Nothing to name, so name nothing; the page below is
  // the workspace picker itself.
  if (!urlNamesOrg(section, orgSlug)) return null

  if (!currentOrg) return null

  /**
   * Whether the URL names a workspace but not THIS one (AGL-2486).
   *
   * One workspace can be in the address bar while this switcher names another
   * with its plan badge beside it. The gate above passes either way, because
   * it asks only whether the route is about SOME workspace; what goes wrong is
   * the NAME, taken from a scope that has fallen through to a remembered
   * selection.
   *
   * Naming nothing at all is not the answer here the way it is on the picker:
   * this route IS about a workspace, and whoever is on it is most likely
   * looking at a 404 they need to escape, so removing their switcher strands
   * them. The control stays and stops ASSERTING instead — no name, no plan
   * badge, no Upgrade CTA for a workspace the page has nothing to do with
   * (AGL-1130) — while still opening the menu below. That is exactly the
   * "pick a workspace to get back on track" the not-found body advises.
   */
  const unclaimed = !urlNamedOrg
  // The pill is the BILLING TIER. Falling back to the member's role meant a
  // free org — which carries no `plan` field — showed "Owner", a role badge
  // masquerading as a plan (AGL-646). No plan means free — but only once the
  // doc has actually resolved (AGL-887): a loading or failed read rendered a
  // Business org as "Free". No answer yet = no badge.
  // A custom-priced enterprise deal reads as "Enterprise" even though its base
  // plan (usually agency) is what drives entitlements (AGL-1110).
  // An unclaimed route gets NO badge: a plan pill is a statement about a
  // specific workspace, and there isn't one to make it about (AGL-2486).
  const currentBadge =
    orgReady && !unclaimed
      ? isEnterpriseOrg(org as never)
        ? ENTERPRISE_PLAN_LABEL
        : titleCase(plan ?? 'free')
      : undefined

  // One label for the button text, the tooltip and the aria-label — the
  // tooltip used to skip the slug fallback, so a slug-only org was "Workspace:
  // org_abc123" on hover while the button read the slug (AGL-1414).
  // On an unclaimed route the control names the ACTION instead of a
  // workspace, and the tooltip/aria-label follow it rather than asserting a
  // "Workspace: …" that isn't true (AGL-2486).
  const orgLabel = unclaimed
    ? 'Choose a workspace'
    : currentOrg.orgName ?? currentOrg.slug ?? currentOrg.$id
  const controlLabel = unclaimed ? orgLabel : `Workspace: ${orgLabel}`

  const orgAvatar = (url?: string) =>
    url ? (
      <Avatar src={url} variant="rounded" sx={{ width: 22, height: 22 }} />
    ) : (
      <Avatar
        variant="rounded"
        // Tertiary, not the accent: the workspace glyph is chrome, and
        // leaving it on `primary` made it compete with every actionable blue
        // in the bar. Pair the glyph with the background it sits on —
        // Avatar's default fallback is `background.default`, which lands at
        // ~1.4:1 against a filled swatch in dark mode and reads dark-on-dark.
        sx={{
          width: 22,
          height: 22,
          bgcolor: 'tertiary.main',
          color: 'tertiary.contrastText',
        }}
      >
        <MdiIcon path={ICON_VARIANT_ORGANIZATION.path} fontSize="small" />
      </Avatar>
    )

  return (
    <>
      <Tooltip title={controlLabel}>
        <Button
          size="small"
          variant="text"
          color="inherit"
          onClick={(event) => setAnchor(event.currentTarget)}
          startIcon={orgAvatar(unclaimed ? undefined : logoUrl)}
          endIcon={
            <MdiIcon path={ICON_VARIANT_MENU_DOWN.path} fontSize="small" />
          }
          // The visible name is hidden on phones (below), so the control must
          // carry its own accessible name rather than borrow one from text
          // that is no longer rendered (AGL-1414).
          aria-label={controlLabel}
          sx={{
            maxWidth: 280,
            // This button is the element that YIELDS when the top bar runs
            // short (AGL-1414). Without min-width:0 it refuses to shrink
            // below its content and pushes the icon cluster off-screen.
            minWidth: 0,
            textTransform: 'none',
            gap: 0.5,
            // The avatar and the caret are the control's affordance — they
            // keep their size while the label absorbs the loss.
            '& .MuiButton-startIcon, & .MuiButton-endIcon': { flexShrink: 0 },
            '& .MuiButton-endIcon': { marginLeft: 0.25 },
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{
              // Below `sm` the workspace name is dropped entirely rather than
              // ellipsised down to two or three characters — at 375px there is
              // only ~40px left for it, and "Nor…" tells you nothing that the
              // avatar does not. The control stays an obvious target (avatar +
              // caret) and keeps its name via the aria-label and the tooltip.
              display: { xs: 'none', sm: 'block' },
              // Written out rather than via `noWrap` so the ellipsis contract
              // and the min-width that makes it work read as one rule.
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {orgLabel}
          </Typography>
          {currentBadge ? (
            <Chip
              label={currentBadge}
              size="small"
              variant="outlined"
              sx={{
                // The plan pill goes with the label on phones — it is ~60px of
                // the ~109px the switcher gets at 375px (AGL-1414). `sm` keeps
                // Chip's own default display rather than restating a new one.
                display: { xs: 'none', sm: 'inline-flex' },
                flexShrink: 0,
                height: 20,
                '& .MuiChip-label': { px: 0.75, fontSize: 11 },
              }}
            />
          ) : null}
        </Button>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        autoFocus={false}
        slotProps={{
          list: { autoFocusItem: false, sx: { pt: 0 } },
          paper: { sx: { width: 320, maxWidth: '90vw', mt: 0.5 } },
        }}
      >
        <SwitcherSearchField
          value={query}
          onChange={setQuery}
          placeholder="Find organization…"
        />
        <Divider />
        <Box
          onScroll={onListScroll}
          sx={{ maxHeight: 280, overflowY: 'auto', py: 0.5 }}
        >
          {filtered.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ px: 2, py: 1.5 }}
            >
              {'No organizations match.'}
            </Typography>
          ) : (
            filtered.map((item) => {
              // Nothing is 'current' on a route whose workspace we did
              // not resolve — a check mark is a claim too (AGL-2486).
              const isCurrent = !unclaimed && item.$id === currentOrg.$id
              // Billing tier, like the button — the current org's plan is
              // known immediately, others resolve as the reads land. Same
              // AGL-887 guard: no resolved doc, no tier.
              const tier = titleCase(
                plans[item.$id] ??
                  (isCurrent && orgReady ? plan ?? 'free' : undefined),
              )
              return (
                <MenuItem
                  key={item.$id}
                  selected={isCurrent}
                  onClick={() => switchTo(item)}
                  sx={{ gap: 1 }}
                >
                  <ListItemIcon sx={{ minWidth: 0 }}>
                    {orgAvatar(isCurrent ? logoUrl : undefined)}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.orgName ?? item.slug ?? item.$id}
                    secondary={
                      item.slug
                        ? `${item.slug}.${WORKSPACE_DOMAIN}`
                        : undefined
                    }
                    slotProps={{
                      primary: { noWrap: true },
                      secondary: { noWrap: true, variant: 'caption' },
                    }}
                  />
                  {tier ? (
                    <Chip
                      label={tier}
                      size="small"
                      variant="outlined"
                      sx={{
                        height: 20,
                        '& .MuiChip-label': { px: 0.75, fontSize: 11 },
                      }}
                    />
                  ) : null}
                  {isCurrent ? (
                    <MdiIcon
                      path={ICON_VARIANT_SYMBOL_CONFIRMED.path}
                      fontSize="small"
                      sx={{ color: 'text.secondary' }}
                    />
                  ) : null}
                </MenuItem>
              )
            })
          )}
          {/* AGL-2336: the list is a WINDOW, and it used to end without
              saying so — an agency in more than 50 workspaces saw 50 and no
              hint that the rest existed, and the search box above filters
              only what is loaded. Say both, and offer the next page. */}
          {hasMoreOrgs ? (
            <Box sx={{ px: 2, py: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.5 }}
              >
                {`Showing ${orgs.length} workspaces — search covers these.`}
              </Typography>
              <Button size="small" onClick={loadMoreOrgs} sx={{ px: 0 }}>
                {'Load more workspaces'}
              </Button>
            </Box>
          ) : null}
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            close()
            setCreating(true)
          }}
          sx={{ gap: 1, py: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 0 }}>
            <Avatar
              variant="rounded"
              sx={{
                width: 22,
                height: 22,
                bgcolor: 'action.hover',
                color: 'text.secondary',
              }}
            >
              <MdiIcon path={ICON_VARIANT_MODIFY_ADD.path} fontSize="small" />
            </Avatar>
          </ListItemIcon>
          <ListItemText
            primary="Create organization"
            secondary="Own sites and share media, data & billing"
            slotProps={{
              primary: { variant: 'body2' },
              secondary: { variant: 'caption' },
            }}
          />
        </MenuItem>
      </Menu>
      <CreateOrgDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
OrgSwitcherNav.displayName = 'OrgSwitcherNav'
OrgSwitcherNav.aglyn = true

export default OrgSwitcherNav
