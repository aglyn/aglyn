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
  ICON_VARIANT_BESIGNER,
  ICON_VARIANT_DATE_TIME,
  ICON_VARIANT_IDENTIFIER,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_PRIMARY_KEY,
  ICON_VARIANT_TEXT,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  Container,
  GridItems,
  MdiIcon,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useScreen } from '@aglyn/tenant-feature-instance'
import { List, ListItem, ListItemIcon, ListItemText } from '@mui/material'
import { useParams } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import AuthenticatedLayout from '../../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'

const whiteSpace = '--'

function ScreenDetails(props) {
  const params = useParams<{
    hostId: string
    screenId: string
    versionId: string
  }>()
  const hostId = params?.hostId as string
  const screenId = params?.screenId as string
  const versionId = params?.versionId as string
  const { queueLoading } = useLoading()
  const { enqueueSnackbar, closeSnackbar } = useSnackbar()
  const {
    doc: { status, data: screen },
  } = useScreen({ hostId, screenId })

  useEffect(() => {
    if (status === 'loading') {
      const dequeue = queueLoading()
      return () => dequeue && dequeue()
    }
  }, [status, queueLoading])

  useEffect(() => {
    if (status === 'error' || (status === 'success' && !screen)) {
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [closeSnackbar, enqueueSnackbar, status, screen])

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
    {
      key: 'dateDeleted',
      primary: 'Date deleted:',
      secondary: screen?.deletedAt?.toDate?.()?.toLocaleString(),
      icon: { path: ICON_VARIANT_DATE_TIME.path },
    },
    {
      key: 'versionId',
      primary: 'Version ID:',
      secondary: screen?.versionId,
      icon: { path: ICON_VARIANT_IDENTIFIER.path },
    },
  ]

  const displayName = useMemo(() => {
    return `${screen?.displayName || 'Not Found'}`
  }, [screen])

  // console.log('Screens props', besignerUrl, props, status, screen)

  return (
    <MainLayout title={[displayName, 'Screen']}>
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
            id: 'nav-tab-setup',
            label: 'Setup',
            href: buildRoute(Route.HOST_SETUP, { hostId }),
          },
        ]}
        activeTab={buildRoute(Route.SCREEN_LIST, { hostId })}
        breadcrumbItems={[
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
          <AppLink
            size="large"
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
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: {
                  xs: 12,
                  md: 6,
                  lg: 4,
                },
                children: (
                  <CardDisplay
                    header={'Basic Details'}
                    // contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <List dense disablePadding>
                      {details.map(
                        ({ primary, secondary, icon, key: itemKey, ...item }, index) => (
                          <ListItem
                            key={itemKey ?? index}
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
                              {...item}
                            />
                          </ListItem>
                        ),
                      )}
                    </List>
                  </CardDisplay>
                ),
              },
              {
                size: {
                  xs: 12,
                  md: 6,
                  lg: 8,
                },
                children: (
                  <CardDisplay
                    header={'Raw JSON'}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <pre>{JSON.stringify(screen, null, 2)}</pre>
                  </CardDisplay>
                ),
              },
            ]}
          />
        </Container>
      </DashboardLayout>
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
