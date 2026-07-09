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
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import {
  Box,
  Chip,
  ListSubheader,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useRouter } from 'next/router'
import { observer } from 'mobx-react-lite'
import { type UIEvent, useCallback, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface BesignerDocumentSwitcherProps {
  hostId: string
  /** The document currently open in the besigner. */
  current: { kind: 'screen' | 'layout'; id: string }
}

const keyOf = (kind: 'screen' | 'layout', id: string) => `${kind}:${id}`

/** Documents fetched per page; the menu loads another page on scroll. */
const PAGE_SIZE = 5
const MENU_HEIGHT = 320

/**
 * App-bar control that shows which screen/layout the besigner is editing and
 * switches to another document from the same host (AGL-50, iterated in
 * AGL-55). Documents load PAGE_SIZE at a time and the menu fetches more as
 * it scrolls, so hosts with many screens don't pay for a full collection
 * read; the current document is read directly so the trigger always renders.
 * Navigating with unsaved canvas changes asks for confirmation first.
 */
export const BesignerDocumentSwitcherComponent = observer(
  function BesignerDocumentSwitcherComponent(
    props: BesignerDocumentSwitcherProps,
  ) {
    const { hostId, current } = props
    const firestore = useFirestore()
    const router = useRouter()
    const { confirm } = useConfirmationContext()
    const [pageCount, setPageCount] = useState(1)
    const fetchLimit = pageCount * PAGE_SIZE

    const { data: screenDocs } = useFirestoreCollection<any>(
      () =>
        query(collection(firestore, 'hosts', hostId, 'screens'), limit(fetchLimit)),
      [firestore, hostId, fetchLimit],
      { idField: '$id' },
    )
    const { data: layoutDocs } = useFirestoreCollection<any>(
      () =>
        query(collection(firestore, 'hosts', hostId, 'layouts'), limit(fetchLimit)),
      [firestore, hostId, fetchLimit],
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

    // The paged window may not include the open document yet — merge it in
    // so the Select always has a matching option for its value.
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

    const currentKey = keyOf(current.kind, current.id)
    const optionsLoaded =
      current.kind === 'screen'
        ? screens.some((screen: any) => screen.$id === current.id)
        : layouts.some((layout: any) => layout.$id === current.id)

    const pathLabel = useCallback(
      (screenId: string) => {
        const path = routingMap?.[screenId]
        return path ? Aglyn.screenRoutePathToUrl(path) : 'not published'
      },
      [routingMap],
    )

    const handleMenuScroll = useCallback(
      (event: UIEvent<HTMLElement>) => {
        const el = event.currentTarget
        if (!mayHaveMore) return
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
          setPageCount((count) => count + 1)
        }
      },
      [mayHaveMore],
    )

    const handleChange = useCallback(
      async (event: SelectChangeEvent<string>) => {
        const value = event.target.value
        if (!value || value === currentKey) return
        if (value === 'view-all') {
          return void router.push(buildRoute(Route.SCREEN_LIST, { hostId }))
        }
        const [kind, id] = value.split(':') as ['screen' | 'layout', string]
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
                hostId,
                screenId: id,
                versionId: target.versionId,
              })
            : buildRoute(Route.LAYOUT_BESIGNER, {
                hostId,
                layoutId: id,
                versionId: target.versionId,
              })
        void router.push(url)
      },
      [currentKey, screens, layouts, confirm, router, hostId],
    )

    // Two-line label: name on top, path (or Layout chip) on its own
    // ellipsized line beneath (AGL-55).
    const renderDocLabel = useCallback(
      (kind: string, id: string, name: string) => (
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Typography variant="body2" component="span" noWrap>
            <strong>{name}</strong>
          </Typography>
          {kind === 'screen' ? (
            <Typography
              variant="caption"
              color="text.secondary"
              component="span"
              noWrap
            >
              {pathLabel(id)}
            </Typography>
          ) : (
            <Chip
              label="Layout"
              size="small"
              variant="outlined"
              sx={{ alignSelf: 'flex-start', height: 16, fontSize: '0.65rem' }}
            />
          )}
        </Box>
      ),
      [pathLabel],
    )

    return (
      <Select
        size="small"
        variant="standard"
        disableUnderline
        value={optionsLoaded ? currentKey : ''}
        onChange={handleChange}
        displayEmpty
        renderValue={(value) => {
          if (!value) return <Typography variant="body2">{'…'}</Typography>
          const [kind, id] = String(value).split(':')
          const docs = kind === 'screen' ? screens : layouts
          const selected = docs.find((item: any) => item.$id === id)
          return renderDocLabel(kind, id, selected?.displayName ?? id)
        }}
        sx={{
          minWidth: 180,
          maxWidth: 320,
          mx: 1,
          borderRadius: 1,
          px: 1,
          py: 0.25,
          '&:hover': { backgroundColor: 'action.hover' },
          '& .MuiSelect-select': { display: 'flex', alignItems: 'center' },
        }}
        MenuProps={{
          slotProps: {
            paper: {
              elevation: 0,
              onScroll: handleMenuScroll,
              sx: {
                // Fixed height with internal scroll; scrolling near the
                // bottom pages in more documents (AGL-55).
                height: MENU_HEIGHT,
                width: '34ch',
                filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                backgroundColor: 'surface.main',
                marginTop: 0.5,
              },
            },
            list: { dense: true },
          },
        }}
        aria-label="Switch edited document"
      >
        <ListSubheader>{'Screens'}</ListSubheader>
        {screens.map((screen: any) => (
          <MenuItem key={screen.$id} value={keyOf('screen', screen.$id)}>
            {renderDocLabel('screen', screen.$id, screen.displayName ?? screen.$id)}
          </MenuItem>
        ))}
        <ListSubheader>{'Layouts'}</ListSubheader>
        {layouts.map((layout: any) => (
          <MenuItem key={layout.$id} value={keyOf('layout', layout.$id)}>
            {renderDocLabel('layout', layout.$id, layout.displayName ?? layout.$id)}
          </MenuItem>
        ))}
        {mayHaveMore ? (
          <MenuItem disabled dense>
            <Typography variant="caption" color="text.secondary">
              {'Scroll to load more…'}
            </Typography>
          </MenuItem>
        ) : null}
        <MenuItem
          value="view-all"
          // Pinned to the bottom of the scrolling menu (AGL-94) so it's
          // reachable without scrolling through the paginated list.
          sx={{
            position: 'sticky',
            bottom: 0,
            zIndex: 1,
            backgroundColor: 'surface.main',
            borderTop: 1,
            borderColor: 'divider',
            '&:hover': { backgroundColor: 'surface.main' },
          }}
        >
          <Typography variant="body2" color="secondary">
            {'View all screens…'}
          </Typography>
        </MenuItem>
      </Select>
    )
  },
)

export default BesignerDocumentSwitcherComponent
