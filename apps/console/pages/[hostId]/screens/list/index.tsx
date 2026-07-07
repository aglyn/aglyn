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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'
import {
  buildScreenRouteEntries,
  composeScreenRoutePath,
  createResourceUid,
  findScreenIdByRoutePath,
  normalizeScreenSlug,
  screenRoutePathToUrl,
  wouldCreateScreenCycle,
  type ScreenRouteNode,
  type ScreenUid,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_CLOSE,
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_SHOW_DETAIL,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  AppLinkNakedLinkProps,
  Container,
  NavigationDrawerComponent,
  SrOnly,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Button, IconButton, Typography } from '@mui/material'
import {
  collection,
  deleteField,
  doc,
  getDoc,
  limit,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollectionData,
  useFirestoreDocData,
} from 'reactfire'
import AuthErrorAlertComponent from '../../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../../components/auth-form-template.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import HostDisplayNameComponent from '../../../../components/host-display-name.component'
import {
  compareScreenSiblings,
  ScreensHierarchyTableComponent,
  type ScreenHierarchyRow,
  type ScreenMoveRequest,
} from '../../../../components/screens-hierarchy-table.component'
import { checkTenantQuota } from '../../../../constants/entitlements'
import { buildRoute, Route } from '../../../../constants/route-links'
import {
  publishScreenRoute,
  syncScreenRouteEntries,
  unpublishScreenRoute,
} from '../../../../constants/screen-publishing'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useCurrentTenant from '../../../../hooks/use-current-tenant'

const CellItemLinkComponent = forwardRef<any, AppLinkNakedLinkProps>(
  (props, ref) => {
    return <AppLink ref={ref} {...props} componentVariant={'naked'} />
  },
)
CellItemLinkComponent.displayName = 'CellItemLinkComponent'

function Screens(props) {
  const params = useParams<{ hostId: string }>()
  const hostId = params?.hostId as string
  const { queueLoading, loading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [quickDrawerOpen, setQuickDrawerOpen] = useState<boolean>(false)
  const handleFormOpen = useCallback(() => {
    setQuickDrawerOpen(true)
  }, [])
  const handleFormClose = useCallback(() => {
    setQuickDrawerOpen(false)
  }, [])
  const firestore = useFirestore()
  const screensCollection = collection(firestore, 'hosts', hostId, 'screens')
  // The hierarchy table renders the whole tree, so no page-sized query: a
  // paginated slice could orphan children whose parent fell off the page.
  const screensQuery = query(screensCollection, limit(200))
  const { status, data } = useFirestoreCollectionData<any>(screensQuery, {
    idField: '$id',
  })
  const screens: ScreenHierarchyRow[] = useMemo(
    () => (data ?? []).filter((screen: any) => !screen.deletedAt),
    [data],
  )
  const { data: hostData } = useFirestoreDocData<any>(
    doc(firestore, 'hosts', hostId),
    { idField: '$id' },
  )
  const routingMap = hostData?.screens as Record<ScreenUid, string> | undefined
  const screensById = useMemo(() => {
    const map: Record<ScreenUid, ScreenRouteNode> = {}
    for (const screen of screens) {
      map[screen.$id] = { slug: screen.slug, parentId: screen.parentId }
    }
    return map
  }, [screens])
  const { enqueueSnackbar, closeSnackbar } = useSnackbar()
  const { tenant } = useCurrentTenant()

  const [error, setError] = useState(null)

  useEffect(() => {
    if (status === 'error') {
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [status])

  const handleFormSubmit = useCallback(
    async (values) => {
      if (loading) return
      if (error) setError(null)
      // Plan quota (AGL-39): enforced once the tenant has an explicit plan.
      const quota = checkTenantQuota(tenant, 'screensPerHost', screens.length)
      if (!quota.allowed) {
        return enqueueSnackbar(
          `Screen limit reached (${quota.limit}) — see Billing to upgrade`,
          { variant: 'warning', persist: false },
        )
      }
      const dequeueLoading = queueLoading()
      const newId = createResourceUid()
      const newVersionId = createResourceUid()
      const timestamp = Timestamp.now()
      const { slug: slugInput, ...fields } = values

      // Publishing is what makes the screen reachable: the tenant matches
      // request paths against the host's `screens` routing map, so the slug
      // must both live on the screen doc and be registered in that map.
      const path = normalizeScreenSlug(slugInput)
      if (path) {
        const hostSnapshot = await getDoc(doc(firestore, 'hosts', hostId))
        const owner = findScreenIdByRoutePath(hostSnapshot.get('screens'), path)
        if (owner) {
          dequeueLoading()
          return enqueueSnackbar(
            `Another screen is already published at ${screenRoutePathToUrl(path)}`,
            { variant: 'warning', persist: false },
          )
        }
      }

      const newValues = {
        ...fields,
        ...(path && { slug: path }),
        versionId: newVersionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const newVersionValue = {
        screenId: newId,
        createdAt: timestamp,
        updatedAt: timestamp,
        nodes: {
          [CANVAS_ROOT_ELEMENT_ID]: {
            $id: CANVAS_ROOT_ELEMENT_ID,
            componentId: 'div',
            nodes: [],
          },
        },
      }
      await Promise.all([
        setDoc(doc(firestore, 'hosts', hostId, 'screens', newId), newValues),
        setDoc(
          doc(
            firestore,
            'hosts',
            hostId,
            'screens',
            newId,
            'versions',
            newVersionId,
          ),
          newVersionValue,
        ),
      ])
        .then(() =>
          path
            ? publishScreenRoute(firestore, { hostId, screenId: newId }, path)
            : undefined,
        )
        .catch((error) => {
          console.error(error)
          setError({ ...error })
          enqueueSnackbar('An error has occurred', {
            variant: 'error',
            allowDuplicate: true,
          })
        })
        .finally(() => {
          handleFormClose()
          dequeueLoading()
        })
    },
    [
      loading,
      error,
      queueLoading,
      firestore,
      hostId,
      handleFormClose,
      enqueueSnackbar,
      tenant,
      screens.length,
    ],
  )

  const handleDeleteScreen = useCallback(
    (id: string, versionId: string) => async () => {
      let dequeueLoading
      await confirm({
        title: 'Are you sure?',
        description:
          "You are about to delete a screen from the application, please confirm the desired option. Press 'Delete' to confirm and delete the item. Press 'Cancel' to void the operation and close this dialog.",
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => {
          dequeueLoading = queueLoading()
        })
        .then(() =>
          Promise.all([
            updateDoc(doc(firestore, 'hosts', hostId, 'screens', id), {
              deletedAt: Timestamp.now(),
            }),
            // A deleted screen must leave the routing map or its path keeps
            // resolving (then 404s deep in the tenant render).
            unpublishScreenRoute(firestore, { hostId, screenId: id }),
          ]),
        )
        .catch(() => {})
        .finally(() => {
          dequeueLoading && dequeueLoading()
        })
    },
    [confirm, firestore, hostId, queueLoading],
  )

  // Drop handler for the hierarchy table: re-parents/reorders the screen,
  // rewrites sibling `order` values, then cascades routing-map paths for the
  // moved screen and its descendants (parent `company` + own `about` →
  // /company/about, same rules as the besigner Publishing section).
  const handleMoveScreen = useCallback(
    async ({ screenId, nextParentId, beforeId }: ScreenMoveRequest) => {
      if (loading) return
      if (wouldCreateScreenCycle(screenId, nextParentId, screensById)) {
        enqueueSnackbar(
          "A screen can't be nested inside itself or its own children",
          { variant: 'warning', persist: false },
        )
        return
      }
      const nextById = {
        ...screensById,
        [screenId]: { ...screensById[screenId], parentId: nextParentId },
      }
      const nextSelfPath = composeScreenRoutePath(screenId, nextById)
      const owner = nextSelfPath
        ? findScreenIdByRoutePath(routingMap, nextSelfPath)
        : undefined
      if (owner && owner !== screenId) {
        enqueueSnackbar(
          `Another screen is already published at ${screenRoutePathToUrl(nextSelfPath as string)}`,
          { variant: 'warning', persist: false },
        )
        return
      }
      const dequeueLoading = queueLoading()
      try {
        const rowById = new Map(screens.map((screen) => [screen.$id, screen]))
        const orderedIds = screens
          .filter(
            (screen) =>
              screen.$id !== screenId &&
              (screen.parentId && screensById[screen.parentId]
                ? screen.parentId
                : undefined) === nextParentId,
          )
          .sort(compareScreenSiblings)
          .map((screen) => screen.$id)
        const insertAt = beforeId ? orderedIds.indexOf(beforeId) : -1
        orderedIds.splice(
          insertAt === -1 ? orderedIds.length : insertAt,
          0,
          screenId,
        )
        const batch = writeBatch(firestore)
        orderedIds.forEach((id, index) => {
          const screenRef = doc(firestore, 'hosts', hostId, 'screens', id)
          if (id === screenId) {
            batch.update(screenRef, {
              parentId: nextParentId ?? deleteField(),
              order: index,
              updatedAt: Timestamp.now(),
            })
          } else if (rowById.get(id)?.order !== index) {
            batch.update(screenRef, { order: index })
          }
        })
        await batch.commit()
        const parentChanged =
          (screensById[screenId]?.parentId ?? undefined) !==
          (nextParentId ?? undefined)
        if (parentChanged) {
          await syncScreenRouteEntries(
            firestore,
            hostId,
            buildScreenRouteEntries(screenId, nextById, routingMap),
          )
        }
        enqueueSnackbar(
          parentChanged && nextSelfPath
            ? `Screen moved — now served at ${screenRoutePathToUrl(nextSelfPath)}`
            : 'Screen moved',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeueLoading()
      }
    },
    [
      loading,
      screens,
      screensById,
      routingMap,
      firestore,
      hostId,
      queueLoading,
      enqueueSnackbar,
    ],
  )

  const renderRowActions = useCallback(
    (row: ScreenHierarchyRow) => (
      <>
        <IconButton
          size="small"
          aria-label="detail"
          component={CellItemLinkComponent as any}
          {...({
            href: buildRoute(Route.SCREEN_DETAILS, {
              hostId,
              screenId: row.$id,
              versionId: row.versionId as string,
            }),
          } as any)}
        >
          <MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} size={0.8} />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Delete"
          onClick={handleDeleteScreen(row.$id, row.versionId as string)}
        >
          <MdiIcon
            path={ICON_VARIANT_MODIFY_DELETE.path}
            color="error"
            size={0.8}
          />
        </IconButton>
      </>
    ),
    [hostId, handleDeleteScreen],
  )

  // console.log('Screens props', props, data, status, screens)

  return (
    <>
      <NextPageTitle screen={'Screens'} />
      <DashboardLayout
        navTabItems={[
          {
            id: 'nav-tab-dashboard',
            label: 'Dashboard',
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            id: 'nav-tab-screens',
            label: 'Screens',
            href: buildRoute(Route.SCREEN_LIST, { hostId }),
          },
          {
            id: 'nav-tab-layouts',
            label: 'Layouts',
            href: buildRoute(Route.LAYOUT_LIST, { hostId }),
          },
          {
            id: 'nav-tab-theme',
            label: 'Theme',
            href: buildRoute(Route.HOST_THEME, { hostId }),
          },
          {
            id: 'nav-tab-media',
            label: 'Media',
            href: buildRoute(Route.HOST_MEDIA, { hostId }),
          },
          {
            id: 'nav-tab-setup',
            label: 'Setup',
            href: buildRoute(Route.HOST_SETUP, { hostId }),
          },
        ]}
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
        ]}
        header={{
          children: 'Screens',
          icon: { path: ICON_VARIANT_PAGES.path },
        }}
        headerRight={
          <Button size="small" variant="contained" onClick={handleFormOpen}>
            {'Create New Screen'}
          </Button>
        }
        aside={
          <NavigationDrawerComponent
            open={quickDrawerOpen}
            anchor="right"
            variant="temporary"
            onClose={handleFormClose}
            AppBarProps={{ color: 'surface' }}
            appBarLeft={
              <>
                <IconButton
                  color="inherit"
                  edge="start"
                  onClick={handleFormClose}
                  sx={{ mr: 2 }}
                >
                  <MdiIcon path={ICON_VARIANT_CLOSE.path} />
                  <SrOnly>close drawer</SrOnly>
                </IconButton>
                <Typography variant="h6" component="div">
                  {'Create new screen'}
                </Typography>
              </>
            }
            appBarRight={
              <Button
                variant="outlined"
                color="inherit"
                onClick={handleFormClose}
              >
                {'Cancel'}
              </Button>
            }
          >
            <Container gutterY>
              <FormRenderer
                FormTemplate={AuthFormTemplateComponent}
                componentMapper={simpleComponentMapper}
                onSubmit={handleFormSubmit}
                schema={formSchema}
                subscription={{ values: true }}
                clearOnUnmount
              />
              <AuthErrorAlertComponent
                error={error as any}
                sx={{ mt: 2, mb: 1 }}
              />
            </Container>
          </NavigationDrawerComponent>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay>
            {/*<AccordionListComponent*/}
            {/*  unique*/}
            {/*  items={screens}*/}
            {/*  AccordionSummaryProps={{ dense: true }}*/}
            {/*  DetailsContentComponent={DetailsContentComponent as any}*/}
            {/*  SummaryContentComponent={SummaryContentComponent as any}*/}
            {/*  getItemId={(item) => item.$id}*/}
            {/*/>*/}
            <ScreensHierarchyTableComponent
              screens={screens}
              routingMap={routingMap}
              loading={status === 'loading'}
              onMoveScreen={handleMoveScreen}
              renderRowActions={renderRowActions}
            />
          </CardDisplay>
        </Container>
      </DashboardLayout>
    </>
  )
}
const formSchema = {
  fields: [
    {
      component: 'text-field',
      name: 'displayName',
      helperText: 'Friendly name for internal reference',
      type: 'text',
      label: 'Display name',
      isRequired: true,
      validate: [
        { type: 'required', message: 'Provide a display name' },
        {
          type: 'max-length',
          threshold: 25,
          message: 'Must not exceed 25 characters',
        },
      ],
    },
    {
      component: 'textarea',
      name: 'description',
      label: 'Description',
      helperText: 'Brief description for internal reference',
      validate: [
        {
          type: 'max-length',
          threshold: 80,
          message: 'Must not exceed 80 characters',
        },
      ],
    },
    {
      component: 'text-field',
      name: 'slug',
      type: 'text',
      label: 'Slug',
      helperText:
        'Path the screen is served at on your site ("/" for the home page). Leave empty to keep it unpublished.',
      validate: [
        {
          type: 'max-length',
          threshold: 60,
          message: 'Must not exceed 60 characters',
        },
      ],
    },
  ],
}
Screens.displayName = 'Page:Screens'
Screens.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Screens',
    },
  },
]

export default Screens
