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
import {
  type MouseEvent,
  type UIEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import { useHostSubdomain } from '../components/host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'
import useFirestoreCollection, {
  type FirestoreCollectionStatus,
} from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import SwitcherSearchField from './switcher-search-field.component'

export interface BesignerDocumentSwitcherProps {
  hostId: string
  /** The document currently open in the besigner. */
  current: { kind: 'screen' | 'layout'; id: string }
}

/** Documents fetched per page; the menu loads another page on scroll. */
const PAGE_SIZE = 5

/**
 * Holds the last successfully-loaded rows through the transient empty gap the
 * collection hook opens on every dependency change. Paging in more documents
 * grows the query's `limit`, which the hook treats as a scope change and
 * clears to `[]` before the larger snapshot lands (AGL-591) — so the raw list
 * would collapse and re-expand on each scroll, flashing the menu. A pagination
 * grow only ever yields a superset, so keeping the prior rows while `status`
 * is `loading` and adopting the new set on `success` removes the flash. The
 * `resetKey` (the host id) drops the held rows when the scope genuinely
 * changes, so a different host never shows the previous one's documents.
 */
function useStableList<T>(
  data: T[],
  status: FirestoreCollectionStatus,
  resetKey: string,
): T[] {
  const held = useRef<T[]>([])
  const key = useRef(resetKey)
  if (key.current !== resetKey) {
    key.current = resetKey
    held.current = []
  }
  if (status === 'success') held.current = data
  return held.current
}

/**
 * App-bar control that shows which screen/layout the besigner is editing and
 * switches to another document from the same host (AGL-50, iterated in
 * AGL-55). It shares the org/site switcher design language (AGL-629): a text
 * button + chevron opens a `Menu` fronted by the shared filter field, with
 * grouped rows, a check on the current document, and a "view all" footer.
 *
 * Documents load PAGE_SIZE at a time and the list fetches more as it scrolls,
 * so hosts with many screens don't pay for a full collection read; the current
 * document is read directly so the trigger always renders. The filter narrows
 * the loaded window client-side, matching the org/site switchers. Navigating
 * with unsaved canvas changes asks for confirmation first.
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
    const [pageCount, setPageCount] = useState(1)
    const [queryText, setQueryText] = useState('')
    const fetchLimit = pageCount * PAGE_SIZE

    const { data: screenDocsRaw, status: screenStatus } =
      useFirestoreCollection<any>(
        () =>
          query(
            collection(firestore, 'hosts', hostId, 'screens'),
            limit(fetchLimit),
          ),
        [firestore, hostId, fetchLimit],
        { idField: '$id' },
      )
    const { data: layoutDocsRaw, status: layoutStatus } =
      useFirestoreCollection<any>(
        () =>
          query(
            collection(firestore, 'hosts', hostId, 'layouts'),
            limit(fetchLimit),
          ),
        [firestore, hostId, fetchLimit],
        { idField: '$id' },
      )
    // Keep the loaded rows visible while a scroll-triggered page grow
    // re-subscribes, so the menu doesn't flash empty and back (AGL-55).
    const screenDocs = useStableList<any>(screenDocsRaw, screenStatus, hostId)
    const layoutDocs = useStableList<any>(layoutDocsRaw, layoutStatus, hostId)
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

    // The paged window may not include the open document yet — merge it in so
    // the trigger always resolves a name and the open row shows a check.
    const screens = useMemo(() => {
      const docs = (screenDocs ?? []).filter((screen: any) => !screen.deletedAt)
      if (
        current.kind === 'screen' &&
        currentDoc?.$id &&
        !docs.some((screen: any) => screen.$id === currentDoc.$id)
      ) {
        docs.push(currentDoc)
      }
      return docs.sort((a: any, b: any) =>
        (a.displayName ?? a.$id).localeCompare(b.displayName ?? b.$id),
      )
    }, [screenDocs, current.kind, currentDoc])
    const layouts = useMemo(() => {
      const docs = (layoutDocs ?? []).filter((layout: any) => !layout.deletedAt)
      if (
        current.kind === 'layout' &&
        currentDoc?.$id &&
        !docs.some((layout: any) => layout.$id === currentDoc.$id)
      ) {
        docs.push(currentDoc)
      }
      return docs.sort((a: any, b: any) =>
        (a.displayName ?? a.$id).localeCompare(b.displayName ?? b.$id),
      )
    }, [layoutDocs, current.kind, currentDoc])

    // Either collection filling its window means there may be more to load.
    const mayHaveMore =
      (screenDocs?.length ?? 0) >= fetchLimit ||
      (layoutDocs?.length ?? 0) >= fetchLimit

    const pathLabel = useCallback(
      (screenId: string) => {
        const path = routingMap?.[screenId]
        return path ? Aglyn.screenRoutePathToUrl(path) : 'not published'
      },
      [routingMap],
    )

    const filteredScreens = useMemo(() => {
      const needle = queryText.trim().toLowerCase()
      if (!needle) return screens
      return screens.filter((screen: any) =>
        [screen.displayName, pathLabel(screen.$id), screen.$id].some(
          (field?: string) => field?.toLowerCase().includes(needle),
        ),
      )
    }, [screens, queryText, pathLabel])
    const filteredLayouts = useMemo(() => {
      const needle = queryText.trim().toLowerCase()
      if (!needle) return layouts
      return layouts.filter((layout: any) =>
        [layout.displayName, layout.$id].some((field?: string) =>
          field?.toLowerCase().includes(needle),
        ),
      )
    }, [layouts, queryText])

    const close = useCallback(() => {
      setAnchorEl(null)
      setQueryText('')
    }, [])

    const handleScroll = useCallback(
      (event: UIEvent<HTMLElement>) => {
        const el = event.currentTarget
        if (!mayHaveMore) return
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
          setPageCount((count) => count + 1)
        }
      },
      [mayHaveMore],
    )

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
    const noMatches = filteredScreens.length === 0 && filteredLayouts.length === 0

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
              sx={{ color: isCurrent ? 'secondary.main' : 'text.secondary' }}
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
          <Box
            onScroll={handleScroll}
            sx={{ maxHeight: 320, overflowY: 'auto', py: 0.5 }}
          >
            {noMatches ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 2, py: 1.5 }}
              >
                {screens.length === 0 && layouts.length === 0
                  ? 'No screens yet.'
                  : 'No matches.'}
              </Typography>
            ) : (
              <>
                {filteredScreens.length > 0 ? (
                  <>
                    <ListSubheader
                      disableSticky
                      sx={{ lineHeight: 2.5, bgcolor: 'transparent' }}
                    >
                      {'Screens'}
                    </ListSubheader>
                    {filteredScreens.map((screen: any) =>
                      renderRow('screen', screen),
                    )}
                  </>
                ) : null}
                {filteredLayouts.length > 0 ? (
                  <>
                    <ListSubheader
                      disableSticky
                      sx={{ lineHeight: 2.5, bgcolor: 'transparent' }}
                    >
                      {'Layouts'}
                    </ListSubheader>
                    {filteredLayouts.map((layout: any) =>
                      renderRow('layout', layout),
                    )}
                  </>
                ) : null}
                {mayHaveMore ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', px: 2, py: 1 }}
                  >
                    {'Scroll to load more…'}
                  </Typography>
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
              slotProps={{ primary: { color: 'secondary' } }}
            />
          </MenuItem>
        </Menu>
      </>
    )
  },
)

export default BesignerDocumentSwitcherComponent
