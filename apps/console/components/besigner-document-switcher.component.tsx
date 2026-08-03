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

import * as Aglyn from '@aglyn/aglyn'
import {
  ICON_VARIANT_DOCUMENT,
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import {
  Box,
  Button,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { observer } from 'mobx-react-lite'
import { type MouseEvent, useCallback, useMemo, useState } from 'react'
import {
  useFirestore,
  useSwitcherCollection,
} from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import { useHostSubdomain } from '../components/host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import SwitcherSearchField from './switcher-search-field.component'

export interface BesignerDocumentSwitcherProps {
  hostId: string
  /** The document currently open in the besigner. */
  current: { kind: 'screen' | 'layout'; id: string }
}

/**
 * Layouts are inherently few (plan caps: 1–3; "unlimited" is still a handful),
 * so they load fully in one bounded read and filter client-side — no name
 * index needed. Screens are the collection that scales, so they go through the
 * server-search hook instead.
 */
const LAYOUT_LIMIT = 25

/**
 * App-bar control that shows which screen/layout the besigner is editing and
 * switches to another document from the same host (AGL-50; AGL-839). It shares
 * the org/site switcher design language (AGL-629): a text button + chevron
 * opens a `Menu` fronted by the shared filter field, with grouped rows, a check
 * on the current document, and a "view all" footer.
 *
 * Screens are served by `useSwitcherCollection` (AGL-838): idle shows a
 * recent-first window, and typing runs a Firestore name-prefix search — so a
 * host with hundreds of screens neither loads them all to reach Layouts nor
 * fails to find a screen that isn't in the loaded window (the old flaw). The
 * open document is read directly so the trigger always resolves and its row
 * shows a check even when it falls outside the window. Navigating with unsaved
 * canvas changes asks for confirmation first.
 */
export const BesignerDocumentSwitcherComponent = observer(
  function BesignerDocumentSwitcherComponent(
    props: BesignerDocumentSwitcherProps,
  ) {
    const { hostId, current } = props
    const firestore = useFirestore()
    const orgSlug = useOrgSlug()
    const host = useHostSubdomain()
    const router = useRouter()
    const { confirm } = useConfirmationContext()
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
    const [queryText, setQueryText] = useState('')

    // Screens: recent-first window when idle, name-prefix search when typing.
    const {
      items: screenHits,
      loading: screensLoading,
      hasQuery,
    } = useSwitcherCollection<any>({
      firestore,
      path: ['hosts', hostId, 'screens'],
      query: queryText,
      idField: '$id',
      filter: (screen) => !screen.deletedAt && screen.kind !== 'email',
      deps: [firestore, hostId],
    })

    // Layouts: few enough to load fully and filter client-side.
    const { data: layoutDocs } = useFirestoreCollection<any>(
      () =>
        query(
          collection(firestore, 'hosts', hostId, 'layouts'),
          limit(LAYOUT_LIMIT),
        ),
      [firestore, hostId],
      { idField: '$id' },
    )
    const { data: currentDoc } = useFirestoreDoc<any>(
      () =>
        doc(
          firestore,
          'hosts',
          hostId,
          current.kind === 'screen' ? 'screens' : 'layouts',
          current.id,
        ),
      [firestore, hostId, current.kind, current.id],
      { idField: '$id' },
    )
    const { data: hostData } = useFirestoreDoc<any>(
      () => doc(firestore, 'hosts', hostId),
      [firestore, hostId],
      { idField: '$id' },
    )
    const routingMap = hostData?.screens as Record<string, string> | undefined

    // Pin the open screen to the top of the idle window so it always shows with
    // a check, even if it isn't among the most-recently-edited. While searching
    // the list is just the matches (the open doc may not match the query).
    const screens = useMemo(() => {
      const list = [...(screenHits ?? [])]
      if (
        !hasQuery &&
        current.kind === 'screen' &&
        currentDoc?.$id &&
        !list.some((screen: any) => screen.$id === currentDoc.$id)
      ) {
        list.unshift(currentDoc)
      }
      return list
    }, [screenHits, hasQuery, current.kind, currentDoc])

    const layouts = useMemo(() => {
      const docs = (layoutDocs ?? []).filter((layout: any) => !layout.deletedAt)
      if (
        current.kind === 'layout' &&
        currentDoc?.$id &&
        !docs.some((layout: any) => layout.$id === currentDoc.$id)
      ) {
        docs.push(currentDoc)
      }
      const sorted = docs.sort((a: any, b: any) =>
        (a.displayName ?? a.$id).localeCompare(b.displayName ?? b.$id),
      )
      // Match the screens' server-side prefix semantics (name-starts-with) so
      // both sections filter the same way, using the same normalization.
      const key = Aglyn.nameSearchKey(queryText)
      if (!key) return sorted
      return sorted.filter((layout: any) =>
        Aglyn.nameSearchKey(layout.displayName ?? layout.$id).startsWith(key),
      )
    }, [layoutDocs, current.kind, currentDoc, queryText])

    const pathLabel = useCallback(
      (screenId: string) => {
        const path = routingMap?.[screenId]
        return path ? Aglyn.screenRoutePathToUrl(path) : 'not published'
      },
      [routingMap],
    )

    const close = useCallback(() => {
      setAnchorEl(null)
      setQueryText('')
    }, [])

    const handleSelect = useCallback(
      async (kind: 'screen' | 'layout', id: string) => {
        close()
        if (kind === current.kind && id === current.id) return
        const target =
          kind === 'screen'
            ? screens.find((screen: any) => screen.$id === id)
            : layouts.find((layout: any) => layout.$id === id)
        if (!target?.versionId) return

        if (!Aglyn.canvas.isInitialSame) {
          const confirmed = await confirm({
            title: 'Discard unsaved changes?',
            description:
              'The canvas has unsaved changes. Switching documents discards ' +
              "them. Press 'Discard' to continue or 'Cancel' to stay.",
            confirmationText: 'Discard',
            confirmationButtonProps: { color: 'error' },
          })
            .then(() => true)
            .catch(() => false)
          if (!confirmed) return
        }

        const url =
          kind === 'screen'
            ? buildRoute(Route.SCREEN_BESIGNER, {
                orgSlug,
                host,
                screenId: id,
                versionId: target.versionId,
              })
            : buildRoute(Route.LAYOUT_BESIGNER, {
                orgSlug,
                host,
                layoutId: id,
                versionId: target.versionId,
              })
        void router.push(url)
      },
      [close, current.kind, current.id, screens, layouts, confirm, orgSlug, host, router],
    )

    const label = currentDoc?.displayName ?? current.id
    // Don't flash "no matches" while a search request is still in flight.
    const empty = screens.length === 0 && layouts.length === 0
    const showEmpty = empty && !screensLoading

    const renderRow = (kind: 'screen' | 'layout', item: any) => {
      const isCurrent = kind === current.kind && item.$id === current.id
      return (
        <MenuItem
          key={item.$id}
          selected={isCurrent}
          onClick={() => handleSelect(kind, item.$id)}
          sx={{ gap: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 0 }}>
            <MdiIcon
              path={
                kind === 'screen'
                  ? ICON_VARIANT_PAGES.path
                  : ICON_VARIANT_DOCUMENT.path
              }
              fontSize="small"
              sx={{ color: isCurrent ? 'primary.main' : 'text.secondary' }}
            />
          </ListItemIcon>
          <ListItemText
            primary={item.displayName ?? item.$id}
            secondary={kind === 'screen' ? pathLabel(item.$id) : undefined}
            slotProps={{
              primary: { noWrap: true },
              secondary: { noWrap: true, variant: 'caption' },
            }}
          />
          {kind === 'layout' ? (
            <Chip
              label="Layout"
              size="small"
              variant="outlined"
              sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
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
    }

    return (
      <>
        <Button
          id="besigner-document-switcher"
          variant="text"
          color="inherit"
          size="small"
          aria-haspopup="menu"
          aria-expanded={anchorEl ? 'true' : undefined}
          aria-label="Switch edited document"
          onClick={(event: MouseEvent<HTMLElement>) =>
            setAnchorEl(event.currentTarget)
          }
          startIcon={
            <MdiIcon
              path={
                current.kind === 'screen'
                  ? ICON_VARIANT_PAGES.path
                  : ICON_VARIANT_DOCUMENT.path
              }
              fontSize="small"
            />
          }
          endIcon={<MdiIcon path={ICON_VARIANT_MENU_DOWN.path} fontSize="small" />}
          sx={{
            maxWidth: 280,
            mx: 1,
            textTransform: 'none',
            '& .MuiButton-endIcon': { marginLeft: 0.25 },
          }}
        >
          <Typography
            variant="subtitle2"
            noWrap
            title={label}
            sx={{ display: 'block', minWidth: 0 }}
          >
            {label}
          </Typography>
          {current.kind === 'layout' ? (
            <Chip
              label="Layout"
              size="small"
              variant="outlined"
              sx={{
                ml: 0.75,
                height: 20,
                '& .MuiChip-label': { px: 0.75, fontSize: 11 },
              }}
            />
          ) : null}
        </Button>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={close}
          autoFocus={false}
          slotProps={{
            list: { autoFocusItem: false, dense: true, sx: { pt: 0 } },
            paper: { sx: { width: 320, maxWidth: '90vw', mt: 0.5 } },
          }}
        >
          <SwitcherSearchField
            value={queryText}
            onChange={setQueryText}
            placeholder="Find screen or layout…"
          />
          <Divider />
          <Box sx={{ maxHeight: 320, overflowY: 'auto', py: 0.5 }}>
            {showEmpty ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 2, py: 1.5 }}
              >
                {hasQuery ? 'No matches.' : 'No screens yet.'}
              </Typography>
            ) : (
              <>
                {screens.length > 0 ? (
                  <>
                    <ListSubheader
                      disableSticky
                      sx={{ lineHeight: 2.5, bgcolor: 'transparent' }}
                    >
                      {'Screens'}
                    </ListSubheader>
                    {screens.map((screen: any) => renderRow('screen', screen))}
                  </>
                ) : null}
                {layouts.length > 0 ? (
                  <>
                    <ListSubheader
                      disableSticky
                      sx={{ lineHeight: 2.5, bgcolor: 'transparent' }}
                    >
                      {'Layouts'}
                    </ListSubheader>
                    {layouts.map((layout: any) => renderRow('layout', layout))}
                  </>
                ) : null}
              </>
            )}
          </Box>
          <Divider />
          <MenuItem
            onClick={() => {
              close()
              void router.push(buildRoute(Route.SCREEN_LIST, { orgSlug, host }))
            }}
            sx={{ gap: 1 }}
          >
            <ListItemIcon sx={{ minWidth: 0 }}>
              <MdiIcon path={ICON_VARIANT_PAGES.path} fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="View all screens"
              slotProps={{ primary: { color: 'primary' } }}
            />
          </MenuItem>
        </Menu>
      </>
    )
  },
)

export default BesignerDocumentSwitcherComponent
