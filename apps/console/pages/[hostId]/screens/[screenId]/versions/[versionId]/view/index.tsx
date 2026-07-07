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
  composeScreenRoutePath,
  findScreenIdByRoutePath,
  HostScreenVisibility,
  normalizeScreenSlug,
  screenRoutePathToUrl,
  type ScreenRouteNode,
  type ScreenUid,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_BESIGNER,
  ICON_VARIANT_DATE_TIME,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_PRIMARY_KEY,
  ICON_VARIANT_SYMBOL_SECURE,
  ICON_VARIANT_TEXT,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteField,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useFirestoreCollectionData, useFirestoreDocData } from 'reactfire'
import AuthenticatedLayout from '../../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../../components/layouts/main.layout'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { hasEntitlement } from '../../../../../../../constants/entitlements'
import hostNavTabItems from '../../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import {
  publishScreenRoute,
  unpublishScreenRoute,
} from '../../../../../../../constants/screen-publishing'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import useCurrentTenant from '../../../../../../../hooks/use-current-tenant'

const whiteSpace = '--'

/** Visibility options (page permissions, AGL-113). Members/password rows
 * explain where enforcement lives so the select never overpromises. */
const VISIBILITY_OPTIONS = [
  {
    value: HostScreenVisibility.PUBLIC,
    label: 'Public',
    hint: 'Anyone with the link; listed in navigation.',
  },
  {
    value: HostScreenVisibility.UNLISTED,
    label: 'Unlisted',
    hint: 'Reachable by URL only.',
  },
  {
    value: HostScreenVisibility.PASSWORD,
    label: 'Password protected',
    hint: 'Visitors must enter the page password.',
  },
  {
    value: HostScreenVisibility.AUTHENTICATED,
    label: 'Members only',
    hint: 'Requires site membership (enforced once site sign-in ships).',
  },
]

function ScreenDetails() {
  const params = useParams<{
    hostId: string
    screenId: string
    versionId: string
  }>()
  const hostId = params?.hostId as string
  const screenId = params?.screenId as string
  const versionId = params?.versionId as string
  const router = useRouter()
  const firestore = useFirestore()
  const { queueLoading, loading } = useLoading()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()

  const screenRef = doc(firestore, 'hosts', hostId, 'screens', screenId)
  const { status, data: screen } = useFirestoreDocData<any>(screenRef, {
    idField: '$id',
  })
  const { data: hostData } = useFirestoreDocData<any>(
    doc(firestore, 'hosts', hostId),
    { idField: '$id' },
  )
  const { data: screenDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    { idField: '$id' },
  )
  const { data: versionDocs } = useFirestoreCollectionData<any>(
    query(
      collection(firestore, 'hosts', hostId, 'screens', screenId, 'versions'),
      limit(50),
    ),
    { idField: '$id' },
  )
  const versions = useMemo(
    () =>
      [...(versionDocs ?? [])].sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      ),
    [versionDocs],
  )

  const routingMap = hostData?.screens as Record<ScreenUid, string> | undefined
  const publishedPath = routingMap?.[screenId]
  const isRoutePublished = publishedPath != null
  const screensById = useMemo(() => {
    const map: Record<ScreenUid, ScreenRouteNode> = {}
    for (const item of screenDocs ?? []) {
      map[item.$id] = { slug: item.slug, parentId: item.parentId }
    }
    return map
  }, [screenDocs])

  useEffect(() => {
    if (status === 'loading') {
      const dequeue = queueLoading()
      return () => dequeue && dequeue()
    }
  }, [status, queueLoading])

  const displayName = screen?.displayName || 'Not Found'
  const schedule =
    screen?.publishSchedule?.status === 'pending'
      ? screen.publishSchedule
      : undefined

  // --- Edit details dialog ---------------------------------------------
  const [editor, setEditor] = useState<{
    displayName: string
    description: string
  } | null>(null)
  const handleEditSave = useCallback(async () => {
    if (!editor?.displayName.trim()) return
    await updateDoc(screenRef, {
      displayName: editor.displayName.trim(),
      description: editor.description.trim(),
      updatedAt: Timestamp.now(),
    })
      .then(() => {
        enqueueSnackbar('Screen updated', { variant: 'success', persist: false })
        setEditor(null)
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [editor, screenRef, enqueueSnackbar])

  // --- Delete -----------------------------------------------------------
  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Delete this screen?',
      description:
        `"${displayName}" is removed from the site and its published ` +
        'path stops resolving.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    const dequeue = queueLoading()
    try {
      await Promise.all([
        updateDoc(screenRef, { deletedAt: Timestamp.now() }),
        unpublishScreenRoute(firestore, { hostId, screenId }),
      ])
      enqueueSnackbar('Screen deleted', { variant: 'success', persist: false })
      router.push(buildRoute(Route.SCREEN_LIST, { hostId }))
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      dequeue()
    }
  }, [
    confirm,
    displayName,
    queueLoading,
    screenRef,
    firestore,
    hostId,
    screenId,
    enqueueSnackbar,
    router,
  ])

  // --- Publish / unpublish the route ------------------------------------
  const [slugInput, setSlugInput] = useState<string | null>(null)
  const slugValue = slugInput ?? screen?.slug ?? ''
  const handlePublishRoute = useCallback(async () => {
    if (loading) return
    const slug = normalizeScreenSlug(slugValue)
    if (!slug && slugValue.trim() !== '/') {
      return enqueueSnackbar('Enter a slug ("/" for the home page)', {
        variant: 'warning',
        persist: false,
      })
    }
    const composed = composeScreenRoutePath(screenId, {
      ...screensById,
      [screenId]: { ...screensById[screenId], slug },
    })
    const owner = composed
      ? findScreenIdByRoutePath(routingMap, composed)
      : undefined
    if (owner && owner !== screenId) {
      return enqueueSnackbar(
        `Another screen is already published at ${screenRoutePathToUrl(composed as string)}`,
        { variant: 'warning', persist: false },
      )
    }
    const dequeue = queueLoading()
    try {
      await publishScreenRoute(
        firestore,
        { hostId, screenId },
        slug,
        composed ?? slug,
      )
      enqueueSnackbar(
        `Published at ${screenRoutePathToUrl(composed ?? slug)}`,
        { variant: 'success', persist: false },
      )
      setSlugInput(null)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      dequeue()
    }
  }, [
    loading,
    slugValue,
    screenId,
    screensById,
    routingMap,
    queueLoading,
    firestore,
    hostId,
    enqueueSnackbar,
  ])

  const handleUnpublishRoute = useCallback(async () => {
    const dequeue = queueLoading()
    try {
      await unpublishScreenRoute(firestore, { hostId, screenId })
      enqueueSnackbar('Screen unpublished', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      dequeue()
    }
  }, [queueLoading, firestore, hostId, screenId, enqueueSnackbar])

  // --- Version publish-now ----------------------------------------------
  const handlePublishVersion = useCallback(
    (id: string) => async () => {
      await updateDoc(screenRef, { versionId: id, updatedAt: Timestamp.now() })
        .then(() =>
          enqueueSnackbar('Version is now live', {
            variant: 'success',
            persist: false,
          }),
        )
        .catch(() =>
          enqueueSnackbar('An error has occurred', { variant: 'error' }),
        )
    },
    [screenRef, enqueueSnackbar],
  )

  // --- Schedule publish / unpublish (AGL-113; Business tier like AGL-61) --
  const [scheduler, setScheduler] = useState<{
    action: 'publish' | 'unpublish'
    versionId: string
    at: string
  } | null>(null)
  const openScheduler = useCallback(
    (action: 'publish' | 'unpublish') => () => {
      if (!hasEntitlement('scheduled-publishing', tenant)) {
        return enqueueSnackbar(
          'Scheduled publishing requires a Business plan — see Billing',
          { variant: 'warning', persist: false },
        )
      }
      const initial = new Date(Date.now() + 60 * 60 * 1000)
      initial.setMinutes(0, 0, 0)
      const pad = (value: number) => String(value).padStart(2, '0')
      setScheduler({
        action,
        versionId: screen?.versionId ?? versions[0]?.$id ?? '',
        at:
          `${initial.getFullYear()}-${pad(initial.getMonth() + 1)}-` +
          `${pad(initial.getDate())}T${pad(initial.getHours())}:${pad(initial.getMinutes())}`,
      })
    },
    [tenant, enqueueSnackbar, screen, versions],
  )
  const handleScheduleConfirm = useCallback(async () => {
    if (!scheduler?.at) return
    const publishAt = new Date(scheduler.at)
    if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) {
      return enqueueSnackbar('Pick a future date/time', {
        variant: 'warning',
        persist: false,
      })
    }
    if (scheduler.action === 'publish' && !scheduler.versionId) return
    await updateDoc(screenRef, {
      publishSchedule: {
        action: scheduler.action,
        ...(scheduler.action === 'publish'
          ? { versionId: scheduler.versionId }
          : {}),
        publishAt: Timestamp.fromDate(publishAt),
        status: 'pending',
        createdAt: Timestamp.now(),
      },
    })
      .then(() => {
        enqueueSnackbar(
          `Scheduled to ${scheduler.action} ${publishAt.toLocaleString()}`,
          { variant: 'success', persist: false },
        )
        setScheduler(null)
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [scheduler, screenRef, enqueueSnackbar])
  const handleScheduleCancel = useCallback(async () => {
    await updateDoc(screenRef, { publishSchedule: deleteField() })
      .then(() =>
        enqueueSnackbar('Schedule canceled', {
          variant: 'success',
          persist: false,
        }),
      )
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [screenRef, enqueueSnackbar])

  // --- Access / permissions ----------------------------------------------
  const visibilityValue = screen?.visibility ?? HostScreenVisibility.PUBLIC
  const handleVisibilityChange = useCallback(
    async (value: number) => {
      const update: Record<string, unknown> = { visibility: value }
      // Leaving password mode drops the stored hash so protection does not
      // silently linger (tenant enforces on the hash, not the mode).
      if (
        value !== HostScreenVisibility.PASSWORD &&
        screen?.protection?.passwordHash
      ) {
        update.protection = deleteField()
      }
      await updateDoc(screenRef, update)
        .then(() =>
          enqueueSnackbar('Page access updated', {
            variant: 'success',
            persist: false,
          }),
        )
        .catch(() =>
          enqueueSnackbar('An error has occurred', { variant: 'error' }),
        )
    },
    [screen, screenRef, enqueueSnackbar],
  )
  const [password, setPassword] = useState('')
  const handlePasswordSave = useCallback(async () => {
    const value = password.trim()
    let update: Record<string, unknown>
    if (!value) {
      update = { protection: deleteField() }
    } else {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value),
      )
      const passwordHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      update = { protection: { passwordHash } }
    }
    await updateDoc(screenRef, update)
      .then(() => {
        enqueueSnackbar(
          value ? 'Password protection enabled' : 'Password protection removed',
          { variant: 'success', persist: false },
        )
        setPassword('')
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [password, screenRef, enqueueSnackbar])

  const details = [
    {
      key: 'id',
      primary: 'Screen ID:',
      secondary: screen?.$id,
      icon: { path: ICON_VARIANT_PRIMARY_KEY.path },
    },
    {
      key: 'displayName',
      primary: 'Display name:',
      secondary: screen?.displayName,
      icon: { path: ICON_VARIANT_TEXT.path },
    },
    {
      key: 'description',
      primary: 'Description:',
      secondary: screen?.description,
      icon: { path: ICON_VARIANT_TEXT.path },
    },
    {
      key: 'dateCreated',
      primary: 'Date created:',
      secondary: screen?.createdAt?.toDate?.()?.toLocaleString(),
      icon: { path: ICON_VARIANT_DATE_TIME.path },
    },
    {
      key: 'dateUpdated',
      primary: 'Last updated:',
      secondary: screen?.updatedAt?.toDate?.()?.toLocaleString(),
      icon: { path: ICON_VARIANT_DATE_TIME.path },
    },
  ]

  return (
    <MainLayout title={[displayName, 'Screen']}>
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        activeTab={buildRoute(Route.SCREEN_LIST, { hostId })}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Screens',
            href: buildRoute(Route.SCREEN_LIST, { hostId }),
          },
          {
            children: displayName,
          },
        ]}
        header={{
          children: displayName,
          icon: { path: ICON_VARIANT_PAGES.path },
        }}
        headerRight={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={() =>
                setEditor({
                  displayName: screen?.displayName ?? '',
                  description: screen?.description ?? '',
                })
              }
            >
              {'Edit'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={handleDelete}
            >
              {'Delete'}
            </Button>
            <AppLink
              size="small"
              variant="contained"
              componentVariant="button"
              href={buildRoute(Route.SCREEN_BESIGNER, {
                hostId,
                screenId,
                versionId,
              })}
              title={'Open with besigner'}
              disabled={status !== 'success' || !screen}
              startIcon={
                <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
              }
            >
              Open Besigner
            </AppLink>
          </Stack>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, md: 6, lg: 4 },
                children: (
                  <CardDisplay
                    header={'Basic Details'}
                    contentGutterY
                    contentBordered="all"
                  >
                    <List dense disablePadding>
                      {details.map(
                        ({ primary, secondary, icon, key: itemKey }) => (
                          <ListItem
                            key={itemKey}
                            alignItems="flex-start"
                            dense
                          >
                            <ListItemIcon
                              sx={{
                                border: `1px solid`,
                                borderColor: 'divider',
                                padding: 1,
                                borderRadius: 1,
                                minWidth: 'unset',
                                marginRight: 2,
                                color: 'tertiary.main',
                              }}
                            >
                              <MdiIcon {...icon} />
                            </ListItemIcon>
                            <ListItemText
                              primary={primary || whiteSpace}
                              secondary={secondary || whiteSpace}
                            />
                          </ListItem>
                        ),
                      )}
                    </List>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6, lg: 4 },
                children: (
                  <CardDisplay
                    header={'Publishing'}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={1.5}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Chip
                          label={isRoutePublished ? 'Published' : 'Unpublished'}
                          color={isRoutePublished ? 'success' : 'default'}
                          size="small"
                        />
                        {isRoutePublished ? (
                          <Typography variant="body2" color="text.secondary">
                            {screenRoutePathToUrl(publishedPath as string)}
                          </Typography>
                        ) : null}
                        {schedule ? (
                          <Chip
                            label={
                              `${schedule.action === 'unpublish' ? 'Unpublishes' : 'Publishes'} ` +
                              `${schedule.publishAt?.toDate?.().toLocaleString() ?? ''}`
                            }
                            color="info"
                            size="small"
                            variant="outlined"
                            onDelete={handleScheduleCancel}
                          />
                        ) : null}
                      </Stack>
                      <TextField
                        size="small"
                        label="Slug"
                        value={slugValue}
                        onChange={(event) => setSlugInput(event.target.value)}
                        helperText={
                          'Path the screen is served at ("/" for the home page).'
                        }
                      />
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ flexWrap: 'wrap', rowGap: 1 }}
                      >
                        <Button
                          size="small"
                          variant="contained"
                          color="secondary"
                          onClick={handlePublishRoute}
                        >
                          {isRoutePublished ? 'Update route' : 'Publish'}
                        </Button>
                        <Button
                          size="small"
                          disabled={!isRoutePublished}
                          onClick={handleUnpublishRoute}
                        >
                          {'Unpublish'}
                        </Button>
                        <Tooltip title="Make a version live at a date/time">
                          <span>
                            <Button
                              size="small"
                              color="secondary"
                              onClick={openScheduler('publish')}
                              startIcon={
                                <MdiIcon
                                  fontSize="inherit"
                                  path={ICON_VARIANT_DATE_TIME.path}
                                />
                              }
                            >
                              {'Schedule publish'}
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title="Take the page offline at a date/time">
                          <span>
                            <Button
                              size="small"
                              color="secondary"
                              disabled={!isRoutePublished}
                              onClick={openScheduler('unpublish')}
                              startIcon={
                                <MdiIcon
                                  fontSize="inherit"
                                  path={ICON_VARIANT_DATE_TIME.path}
                                />
                              }
                            >
                              {'Schedule unpublish'}
                            </Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6, lg: 4 },
                children: (
                  <CardDisplay
                    header={'Page Access'}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={1.5}>
                      <TextField
                        select
                        size="small"
                        label="Visibility"
                        value={visibilityValue}
                        onChange={(event) =>
                          handleVisibilityChange(Number(event.target.value))
                        }
                      >
                        {VISIBILITY_OPTIONS.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Typography variant="caption" color="text.secondary">
                        {
                          VISIBILITY_OPTIONS.find(
                            (option) => option.value === visibilityValue,
                          )?.hint
                        }
                      </Typography>
                      {visibilityValue === HostScreenVisibility.PASSWORD ? (
                        <Stack direction="row" spacing={1}>
                          <TextField
                            size="small"
                            type="password"
                            label="Page password"
                            value={password}
                            onChange={(event) =>
                              setPassword(event.target.value)
                            }
                            helperText={
                              screen?.protection?.passwordHash
                                ? 'A password is set — save a new one to change it.'
                                : 'Save a password to protect this page.'
                            }
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            color="secondary"
                            onClick={handlePasswordSave}
                            sx={{ alignSelf: 'flex-start' }}
                            startIcon={
                              <MdiIcon
                                fontSize="inherit"
                                path={ICON_VARIANT_SYMBOL_SECURE.path}
                              />
                            }
                          >
                            {'Save'}
                          </Button>
                        </Stack>
                      ) : null}
                      <Typography variant="caption" color="text.secondary">
                        {'Per-user editor permissions arrive with the team ' +
                          'user manager.'}
                      </Typography>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, lg: 8 },
                children: (
                  <CardDisplay
                    header={'Versions'}
                    contentBordered="all"
                  >
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{'Version'}</TableCell>
                          <TableCell>{'Created'}</TableCell>
                          <TableCell align="right">{'Actions'}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {versions.map((version) => {
                          const isLive = version.$id === screen?.versionId
                          return (
                            <TableRow key={version.$id} hover>
                              <TableCell>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ alignItems: 'center' }}
                                >
                                  <span>
                                    {version.displayName ?? version.$id}
                                  </span>
                                  {isLive ? (
                                    <Chip
                                      label="Live"
                                      color="success"
                                      size="small"
                                    />
                                  ) : null}
                                  {schedule?.versionId === version.$id &&
                                  schedule?.action !== 'unpublish' ? (
                                    <Chip
                                      label="Scheduled"
                                      color="info"
                                      size="small"
                                      variant="outlined"
                                    />
                                  ) : null}
                                </Stack>
                              </TableCell>
                              <TableCell>
                                {version.createdAt
                                  ?.toDate?.()
                                  .toLocaleString() ?? whiteSpace}
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{ whiteSpace: 'nowrap' }}
                              >
                                <Button
                                  size="small"
                                  color="secondary"
                                  disabled={isLive}
                                  onClick={handlePublishVersion(version.$id)}
                                >
                                  {'Publish now'}
                                </Button>
                                <AppLink
                                  size="small"
                                  componentVariant="button"
                                  href={buildRoute(Route.SCREEN_PREVIEW, {
                                    hostId,
                                    screenId,
                                    versionId: version.$id,
                                  })}
                                >
                                  {'Preview'}
                                </AppLink>
                                <AppLink
                                  size="small"
                                  componentVariant="button"
                                  href={buildRoute(Route.SCREEN_BESIGNER, {
                                    hostId,
                                    screenId,
                                    versionId: version.$id,
                                  })}
                                >
                                  {'Besigner'}
                                </AppLink>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, lg: 4 },
                children: (
                  <CardDisplay
                    header={'Raw JSON'}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <pre style={{ overflowX: 'auto', margin: 0 }}>
                      {JSON.stringify(screen, null, 2)}
                    </pre>
                  </CardDisplay>
                ),
              },
            ]}
          />
        </Container>
      </DashboardLayout>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Edit screen'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Display name"
            value={editor?.displayName ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, displayName: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={editor?.description ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!editor?.displayName.trim()}
            onClick={handleEditSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(scheduler)}
        onClose={() => setScheduler(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {scheduler?.action === 'unpublish'
            ? 'Schedule unpublish'
            : 'Schedule publication'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <DialogContentText variant="body2">
            {scheduler?.action === 'unpublish'
              ? 'The page goes offline once the time passes (applied on the ' +
                'next site refresh). Only one pending schedule exists per page.'
              : 'The selected version becomes the live version at the chosen ' +
                'time (applied on the next site refresh after it passes). ' +
                'Only one pending schedule exists per page.'}
          </DialogContentText>
          {scheduler?.action === 'publish' ? (
            <TextField
              select
              size="small"
              label="Version"
              value={scheduler.versionId}
              onChange={(event) =>
                setScheduler((prev) =>
                  prev ? { ...prev, versionId: event.target.value } : prev,
                )
              }
            >
              {versions.map((version) => (
                <MenuItem key={version.$id} value={version.$id}>
                  {version.displayName ?? version.$id}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField
            size="small"
            type="datetime-local"
            label={scheduler?.action === 'unpublish' ? 'Unpublish at' : 'Publish at'}
            value={scheduler?.at ?? ''}
            onChange={(event) =>
              setScheduler((prev) =>
                prev ? { ...prev, at: event.target.value } : prev,
              )
            }
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScheduler(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={
              !scheduler?.at ||
              (scheduler?.action === 'publish' && !scheduler?.versionId)
            }
            onClick={handleScheduleConfirm}
          >
            {'Schedule'}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  )
}
ScreenDetails.displayName = 'Page:ScreenDetails'
ScreenDetails.layouts = [
  {
    Component: AuthenticatedLayout,
  },
]

export default ScreenDetails
