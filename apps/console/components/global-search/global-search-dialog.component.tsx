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

import { ICON_VARIANT_SEARCH } from '@aglyn/shared-data-enums'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { resolveOrgEntitlements } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  Box,
  CircularProgress,
  Dialog,
  Divider,
  InputBase,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { buildRoute } from '../../constants/route-links'
import { useHostId, useHostReady, useHostSubdomain } from '../host-id-provider'
import { useOrgSlug } from '../../hooks/use-org-scope'
import { useUrlNamedOrg } from '../../hooks/use-url-names-org'
import useCurrentOrg from '../../hooks/use-current-org'
import DocsHelpTip from '../docs-help-tip.component'
import {
  buildResultHref,
  globalSearchScopeMessage,
  resolveGlobalSearchScope,
} from './global-search-scope'
import useGlobalSearch, { SEARCH_MAX_ITEMS } from './use-global-search'
import { MIN_QUERY_LENGTH } from '@aglyn/aglyn'

export interface GlobalSearchDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Console-wide search (AGL-2179, rebuilt under AGL-2486).
 *
 * A dialog rather than a field in the top bar, and that is a deliberate
 * reading of AGL-1414: `TopAppBar` carries the besigner's FILE/EDIT/INSERT
 * menubar in its centre slot, its clusters are tuned around a measured 375px
 * budget, and a `min-width: 0` chain runs through it that a single `auto`
 * anywhere in the middle breaks. An icon button in the existing `flexShrink: 0`
 * cluster costs a fixed ~40px and cannot distort the chain, and the field
 * itself lives in here where there is room to be honest about what it searches.
 *
 * ## The dead click, named
 *
 * Zach: *"console search does not seem to do anything when you click on it"*.
 * Driven against a real signed-in console, the row markup turned out to be
 * sound — the anchor carries its `href`, `AppLink` resolves it through
 * `NextLink`, and clicking one navigates. Two other things were producing the
 * symptom, and both are fixed here:
 *
 * 1. **Typing emptied the list.** See `global-search-scope.ts` — the old
 *    prefix query ordered by a field most documents do not carry, so results
 *    vanished the moment a character was typed. That is the bulk of the fix
 *    and it lives in the scope and match modules.
 * 2. **A second dialog made this one inert.** Every MUI `Dialog` renders at
 *    `theme.zIndex.modal`, so when two are mounted the winner is decided by
 *    DOM order, and the palette is reachable from the top bar of EVERY
 *    console page — including pages that raise their own dialog. Measured
 *    with `document.elementFromPoint` at each row's centre: with the
 *    notifications prompt mounted, every row hit-tests to the OTHER dialog's
 *    container and Playwright refuses the click outright ("subtree intercepts
 *    pointer events"); dismiss it and the same rows hit-test to themselves and
 *    navigate. The palette now sits one step above `modal`, which is correct
 *    for it specifically: it is opened by an explicit gesture, it is
 *    transient, and Escape closes it — so it can never strand the reader
 *    behind it the way a genuine confirmation dialog could.
 */
export function GlobalSearchDialogComponent(props: GlobalSearchDialogProps) {
  const { open, onClose } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  // The URL-named workspace, matching the trigger (AGL-2486) — the dialog
  // labels itself "Search this workspace" and narrows its reads by this id,
  // so it must not be a workspace the route never mentioned.
  const currentOrg = useUrlNamedOrg()
  const { org, ready: orgReady } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const hostId = useHostId()
  const hostReady = useHostReady()
  const hostSubdomain = useHostSubdomain()
  const [text, setText] = useState('')

  const uid = user?.uid ?? null
  const orgId = currentOrg?.$id ?? null

  // Quotas and feature flags flattened into one lookup, because a group is
  // gated by whichever of the two its definition names. `null` until the org
  // has actually resolved: a loading default that answers "free tier" would
  // hide half the palette from a paying workspace for the first second of
  // every page, and hiding a group is indistinguishable from having none.
  const entitlements = useMemo(() => {
    if (!orgReady || !org) return null
    const resolved = resolveOrgEntitlements(org as any)
    return { ...resolved, ...(resolved as any).features } as Record<string, unknown>
  }, [org, orgReady])

  const scope = useMemo(
    () =>
      resolveGlobalSearchScope({
        orgId,
        hostId,
        hostReady,
        entitlements,
        entitlementsReady: orgReady,
      }),
    [orgId, hostId, hostReady, entitlements, orgReady],
  )

  // Reset between openings so a stale query never renders against a scope it
  // was not typed in — reopening on a different site is a scope change.
  useEffect(() => {
    if (!open) setText('')
  }, [open])

  const { groups, loading, active, total, readCount } = useGlobalSearch({
    firestore,
    entities: scope.entities,
    uid,
    orgId,
    hostId,
    text,
  })

  const rows = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        items: group.rows
          .map((row) => ({
            key: `${group.definition.id}:${row.$id}`,
            label: row.$label || String(row.$id),
            href: buildResultHref(
              group.definition.id,
              row,
              { orgSlug, hostSubdomain },
              buildRoute as any,
            ),
          }))
          // A row with nowhere to go is dropped rather than rendered dead —
          // an inert row is the complaint this issue opened with.
          .filter((item) => Boolean(item.href)),
      })),
    [groups, orgSlug, hostSubdomain],
  )

  const scopeMessage = globalSearchScopeMessage(scope, SEARCH_MAX_ITEMS)
  const shown = rows.reduce((sum, group) => sum + group.items.length, 0)
  const anyFailed = rows.some((group) => group.failed)
  /*
    A group that was only partly read has something to say even with no rows,
    and "Nothing matched." would contradict it (AGL-2179). Measured on
    `aglyn-marketing`: 54 screens, `pric` matched none of the 30 that had been
    read, and the reader was told nothing matched — over a site whose /pricing
    page is one of its most visited. The read escalates now, so this is the
    residue: a collection bigger than the ceiling, which still must not be
    reported as an empty one.
  */
  const anyIncomplete = rows.some((group) => group.truncated && !group.failed)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { alignSelf: 'flex-start', mt: 8 } } }}
      // See the class comment: a palette that another dialog can render inert
      // is the reported defect. `modal + 1` rather than a large constant so
      // the snackbar and tooltip layers above it are untouched.
      sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
      aria-label="Search this workspace"
    >
      <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.5 }}>
        <MdiIcon
          path={ICON_VARIANT_SEARCH.path}
          sx={{ color: 'text.disabled', mr: 1.5 }}
        />
        <InputBase
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={scope.placeholder}
          autoFocus
          fullWidth
          inputProps={{ 'aria-label': scope.placeholder }}
          sx={{ fontSize: 16 }}
        />
        {loading ? <CircularProgress size={16} /> : null}
      </Stack>
      <Divider />

      <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
        {!active ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ px: 2, py: 3 }}
          >
            {`Type at least ${MIN_QUERY_LENGTH} characters to search.`}
          </Typography>
        ) : shown === 0 && !loading && !anyFailed && !anyIncomplete ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ px: 2, py: 3 }}
          >
            Nothing matched.
          </Typography>
        ) : (
          <List dense disablePadding>
            {rows.map((group) => (
              <Box key={group.definition.id}>
                {group.items.length === 0 &&
                !group.failed &&
                !group.truncated ? null : (
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ display: 'block', px: 2, pt: 1.5 }}
                  >
                    {group.definition.group}
                  </Typography>
                )}
                {/*
                  A failed group SAYS it failed. Folding the failure into an
                  empty group would render a read error as a measured zero,
                  which is worse than an error because nothing looks wrong —
                  the reader concludes they do not have the thing.
                */}
                {group.failed ? (
                  <Typography
                    variant="body2"
                    color="error"
                    sx={{ px: 2, py: 1 }}
                  >
                    {`${group.definition.group} could not be searched — this is a read error, not an empty result.`}
                  </Typography>
                ) : null}
                {group.items.map((item) => (
                  <ListItemButton
                    key={item.key}
                    component={AppLink}
                    href={item.href as string}
                    onClick={onClose}
                  >
                    <ListItemText
                      primary={item.label}
                      secondary={group.definition.group}
                      slotProps={{ primary: { noWrap: true } }}
                    />
                  </ListItemButton>
                ))}
                {/*
                  The window filled, so this group may hold matches that were
                  never read. Saying so is what stops a partial set from
                  reading as a complete one — and the ZERO-row wording is the
                  one that matters, because that is the case a bare
                  "Nothing matched." would have misreported as an answer.

                  The count comes from the group rather than from a constant:
                  after an escalation the number actually searched is not
                  `SEARCH_WINDOW`, and quoting the constant would understate
                  what was looked at by an order of magnitude.
                */}
                {group.truncated && !group.failed ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', px: 2, pb: 1 }}
                  >
                    {group.items.length === 0
                      ? `No match among the ${group.searched} ${group.definition.noun} searched — this site has more that were not read, so this is not "none".`
                      : `Only the first ${group.searched} ${group.definition.noun} were searched.`}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </List>
        )}
      </Box>

      {scopeMessage ? (
        <>
          <Divider />
          {/*
            The honest half. `total` is referenced so the count the reader
            sees and the count the hook produced cannot drift apart.
          */}
          <Stack
            direction="row"
            sx={{ alignItems: 'center', gap: 0.5, px: 2, py: 1.25 }}
          >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block' }}
            data-search-total={total}
            /*
              The measured read cost of this palette session, surfaced so it
              can be ASSERTED rather than estimated — `global-search.e2e.mjs`
              reads it after driving a real signed-in console, and the number
              in the issue comes from there. A cost claim nobody can check is
              the kind that drifts.
            */
            data-search-reads={readCount}
          >
            {scopeMessage}
          </Typography>
          {/*
            The caption states the RULE; the full list of what is and is not
            searchable, and why a group can report being only partly searched,
            is a page rather than a sentence. `DOCS_HELP_TOPICS.consoleSearch`
            is that page, and this is its one call site.
          */}
          <DocsHelpTip topic="consoleSearch" />
          </Stack>
        </>
      ) : null}
    </Dialog>
  )
}

export default GlobalSearchDialogComponent
