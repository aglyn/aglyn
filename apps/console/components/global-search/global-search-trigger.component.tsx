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
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { IconButton, Tooltip } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHostId, useHostReady } from '../host-id-provider'
import { useUrlNamedOrg } from '../../hooks/use-url-names-org'
import useCurrentOrg from '../../hooks/use-current-org'
import GlobalSearchDialogComponent from './global-search-dialog.component'
import { resolveGlobalSearchScope } from './global-search-scope'

/**
 * The top bar's search affordance (AGL-2179).
 *
 * An icon button, not a text field, because of AGL-1414's measured 375px
 * budget — see the note on `GlobalSearchDialogComponent`. It sits in the
 * cluster that is already `flexShrink: 0`, so it takes a fixed width from the
 * `flexGrow: 1` centre column and cannot reach the `min-width: 0` chain the
 * org switcher's ellipsis depends on.
 *
 * It renders NOTHING when there is nothing to search — the workspace picker,
 * or any surface reached before the org resolves. A button that opens a field
 * that can answer nothing is the defect this issue is about, at a smaller
 * size, and hiding it is cheaper than explaining it.
 */
export function GlobalSearchTriggerComponent() {
  // The workspace the URL NAMES (AGL-2486). Reading `currentOrg` here made
  // the "renders NOTHING on the workspace picker" promise above untrue: the
  // scope never resolves to null off an org route, it falls back to a
  // remembered selection, so the button DID render on `/`, `/manage/*` and
  // `/admin/*` — and opened a field labelled "Search this workspace" over
  // whichever org the fallback happened to land on. On the picker that is a
  // page whose entire purpose is that you have not chosen one yet.
  const currentOrg = useUrlNamedOrg()
  const { ready: orgReady } = useCurrentOrg()
  const hostId = useHostId()
  const hostReady = useHostReady()
  const [open, setOpen] = useState(false)

  // The trigger only needs to know whether ANYTHING is searchable, and the
  // ungated groups (pages, content, authors) settle that on their own — so it
  // deliberately passes no entitlements. Resolving them here would make the
  // button flicker in on every navigation as the org doc lands, and the
  // dialog does its own, complete, resolution when it opens.
  const scope = useMemo(
    () =>
      resolveGlobalSearchScope({
        orgId: currentOrg?.$id ?? null,
        hostId,
        hostReady,
        entitlements: null,
        entitlementsReady: orgReady,
      }),
    [currentOrg?.$id, hostId, hostReady, orgReady],
  )

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (scope.unavailable) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'k' && event.key !== 'K') return
      if (!event.metaKey && !event.ctrlKey) return
      // The browser's own find-in-page and the besigner's shortcuts both live
      // near here; claiming the chord only when it is ours keeps them intact.
      event.preventDefault()
      setOpen((previous) => !previous)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scope.unavailable])

  if (scope.unavailable) return null

  return (
    <>
      <Tooltip title={`${scope.placeholder} (⌘K)`}>
        <IconButton
          size="small"
          color="inherit"
          onClick={() => setOpen(true)}
          aria-label={scope.placeholder}
          aria-keyshortcuts="Meta+K Control+K"
        >
          <MdiIcon path={ICON_VARIANT_SEARCH.path} />
        </IconButton>
      </Tooltip>
      {/*
        Mounted only while open, deliberately. This trigger renders in the top
        bar of EVERY console page, and the dialog's two reads are issued by
        hooks — so passing `open={false}` to a mounted dialog would put a
        `hostMemberships` query and a `screens` query on every navigation in
        the console, to populate a palette nobody has asked for.
      */}
      {open ? (
        <GlobalSearchDialogComponent open onClose={close} />
      ) : null}
    </>
  )
}

export default GlobalSearchTriggerComponent
