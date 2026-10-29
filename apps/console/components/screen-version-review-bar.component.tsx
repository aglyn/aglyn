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

import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { screenRoutePathToUrl, toScreenRouteNode, type ScreenRouteNode } from '@aglyn/aglyn/app-utils/screen-route'
import { screenVersionPublish } from '@aglyn/aglyn/app-utils/screen-version-publish'
import { AppLink, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useScreen, useUser } from '@aglyn/tenant-feature-instance'
import { Button, Paper, Stack, Typography } from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { readPreviewState } from '../constants/preview-state'
import { buildRoute, Route } from '../constants/route-links'
import { publishScreenRoute } from '../constants/screen-publishing'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import useFormsPublishBlock from '../hooks/use-forms-publish-block'
import useHostActivityLogger from '../hooks/use-host-activity-logger'
import useHostRole from '../hooks/use-host-role'
import { describeRevalidateShortfall, revalidateLivePages } from '../utils/revalidate-live-pages'

/** Said on Publish where the member's role on the site cannot make content live (AGL-2334). */
export const REVIEW_PUBLISH_ROLE_REASON = 'Your role on this site can edit content but not publish it.'

/** Said where the preview shows a Besigner snapshot, which may hold changes that were never saved. */
export const REVIEW_SNAPSHOT_REASON =
  'This preview shows changes from the Besigner that may not be saved. Publish them from the Besigner.'

export interface ScreenVersionReviewBarProps {
  hostId: string | null | undefined
  orgSlug: string
  host: string
  screenId: string
  versionId: string
}

/**
 * The preview of one page version, with the two things a person does next
 * (AGL-3616): publish it, or open it in the Besigner. An AI job that changed
 * a page leads here, and this is where its draft goes live.
 *
 * Publish is the page's own: on a live page it makes this version the one
 * the site serves, as the Besigner's Publish does; on a page that is not on
 * the site it puts the page at its address with this version, as the page's
 * Publish does, refused for the same reasons (`screenVersionPublish`). It is
 * asked once, and never offered over a Besigner snapshot, whose unsaved
 * changes are not what it would publish.
 */
export function ScreenVersionReviewBar(props: ScreenVersionReviewBarProps) {
  const { orgSlug, host, screenId, versionId } = props
  const hostId = props.hostId ?? ''
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const { canPublish, loaded: roleLoaded } = useHostRole(hostId || undefined)
  const { refuse: refuseFormsOff } = useFormsPublishBlock()
  const { doc: screenResult, setDoc: updateScreenDoc } = useScreen({ hostId, screenId })
  // `null` once read and not there; `undefined` while the read is out.
  const screen =
    screenResult?.status === 'success'
      ? ((screenResult.data as Record<string, unknown> | undefined) ?? null)
      : undefined
  const { data: hostData, status: hostStatus } = useFirestoreDoc<any>(() => doc(firestore, 'hosts', hostId), [firestore, hostId])
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: version } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'screens', screenId, 'versions', versionId),
    [firestore, hostId, screenId, versionId],
  )
  const [publishing, setPublishing] = useState(false)

  // A snapshot the Besigner wrote for this version, which the preview shows in place of what is saved.
  const fromSnapshot = useMemo(
    () => (hostId ? readPreviewState({ hostId, kind: 'screen', docId: screenId, versionId }) !== null : false),
    [hostId, screenId, versionId],
  )
  const screensById = useMemo(() => {
    const map: Record<string, ScreenRouteNode> = {}
    for (const item of screenDocs ?? []) map[item.$id] = toScreenRouteNode(item)
    return map
  }, [screenDocs])
  const ready = Boolean(hostId && screen !== undefined && hostStatus === 'success' && screenDocs)
  const outcome = ready
    ? screenVersionPublish({
        screenId,
        versionId,
        screen: screen as Record<string, unknown> | null,
        routingMap: hostData?.screens,
        screensById,
        defaultHomeScreenId: hostData?.defaultHomeScreenId ?? null,
      })
    : null
  const displayName = typeof screen?.['displayName'] === 'string' ? (screen['displayName'] as string) : 'this page'

  const blockedReason = !outcome
    ? null
    : outcome.kind === 'blocked'
      ? outcome.reason
      : fromSnapshot && outcome.kind !== 'live'
        ? REVIEW_SNAPSHOT_REASON
        : roleLoaded && !canPublish && outcome.kind !== 'live'
          ? REVIEW_PUBLISH_ROLE_REASON
          : null
  const status = !outcome
    ? 'Loading…'
    : outcome.kind === 'live'
      ? `This version is live at ${screenRoutePathToUrl(outcome.path)}.`
      : outcome.kind === 'replace'
        ? `A draft. The live page at ${screenRoutePathToUrl(outcome.path)} shows another version.`
        : outcome.kind === 'first'
          ? 'A draft. This page is not on your site yet.'
          : null

  const publish = useCallback(async () => {
    if (!outcome || (outcome.kind !== 'replace' && outcome.kind !== 'first')) return
    if (refuseFormsOff(decodeStoredNodes(version?.nodes))) return
    const url = screenRoutePathToUrl(outcome.path)
    const confirmed = await confirm({
      title: `Publish ${displayName}?`,
      description:
        outcome.kind === 'replace'
          ? `Visitors will see this version at ${url} in place of the one they see now.`
          : `This page goes live at ${url}, with this version.`,
      confirmationText: 'Publish',
      // Over the preview's own chrome, this bar and the consent panel included.
      dialogProps: { sx: { zIndex: 'max' } },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setPublishing(true)
    try {
      if (outcome.kind === 'first' || outcome.placeholder) {
        // The route and the pointer in one write: the page's own Publish,
        // and the placeholder home becoming the owner's (AGL-3478).
        await publishScreenRoute(
          firestore,
          { hostId, screenId, versionId, user },
          outcome.kind === 'first' ? outcome.slug : String(screen?.['slug'] ?? outcome.path),
          outcome.path,
        )
      } else {
        // The pointer write is the publish, as the Besigner's.
        await updateScreenDoc({ versionId } as never)
        void revalidateLivePages({ user, hostId, screenId }).then((result) => {
          const shortfall = describeRevalidateShortfall(result)
          if (shortfall) enqueueSnackbar(shortfall, { variant: 'warning', persist: false })
        })
      }
      logActivity(`Published ${url}`, { type: 'screen', id: screenId, name: displayName })
      enqueueSnackbar(`Published at ${url}`, { variant: 'success', persist: false })
    } catch (error) {
      // A publish that throws must never read like a success (AGL-1334).
      console.error(error)
      enqueueSnackbar(`It was not published: ${(error as Error | undefined)?.message ?? 'something went wrong'}`, {
        variant: 'error',
        persist: true,
        allowDuplicate: true,
      })
    } finally {
      setPublishing(false)
    }
  }, [
    outcome,
    refuseFormsOff,
    version?.nodes,
    confirm,
    displayName,
    firestore,
    hostId,
    screenId,
    versionId,
    user,
    screen,
    updateScreenDoc,
    enqueueSnackbar,
    logActivity,
  ])

  if (!hostId) return null
  const besignerHref = buildRoute(Route.SCREEN_BESIGNER, { orgSlug, host, screenId, versionId })
  const offersPublish = outcome?.kind !== 'live'

  return (
    <Paper
      elevation={4}
      role="region"
      aria-label="Review this version"
      sx={(theme) => ({
        position: 'fixed',
        left: theme.spacing(1.5),
        bottom: theme.spacing(1.5),
        // Above the previewed page and its modals, under the console's toasts,
        // which open at this corner and say what Publish did.
        zIndex: theme.zIndex.snackbar - 1,
        p: 1.5,
        maxWidth: `min(${theme.spacing(52)}, calc(100vw - ${theme.spacing(3)}))`,
      })}
    >
      <Stack spacing={1.5}>
        {status ? (
          <Typography variant="body2" color="text.secondary">
            {status}
          </Typography>
        ) : null}
        {blockedReason ? (
          <Typography variant="body2" color="warning.main">
            {blockedReason}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button variant={offersPublish ? 'outlined' : 'contained'} size="small" component={AppLink} href={besignerHref}>
            {'Open in Besigner'}
          </Button>
          {offersPublish ? (
            <Button
              variant="contained"
              size="small"
              disabled={!outcome || Boolean(blockedReason) || !roleLoaded || publishing}
              onClick={() => void publish()}
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </Paper>
  )
}

export default ScreenVersionReviewBar
