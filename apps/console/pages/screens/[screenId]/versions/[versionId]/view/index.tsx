/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {
  ICON_VARIANT_BESIGNER,
  ICON_VARIANT_DATE_TIME,
  ICON_VARIANT_IDENTIFIER,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_PRIMARY_KEY,
  ICON_VARIANT_TEXT,
} from '@aglyn/shared-data-enums'
import { useScreen } from '@aglyn/tenant-feature-instance'
import {
  AppLink,
  ContainerComponent,
  GridItems,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { List, ListItem, ListItemIcon, ListItemText } from '@mui/material'
import { useRouter } from 'next/router'
import { useEffect } from 'react'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import ConsoleLayout from '../../../../../../components/layouts/console.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import WidgetCardComponent from '../../../../../../components/widget-card.component'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'

const whiteSpace = '--'

function ScreenDetails(props) {
  const { query } = useRouter()
  const screenId = `${query.screenId}`
  const versionId = `${query.versionId}`
  const besignerUrl = buildRoute(Route.SCREEN_BESIGNER, { screenId, versionId })
  const { queueLoading } = useLoading()
  const { enqueueSnackbar, closeSnackbar } = useSnackbar()
  const [{ status, data: screen }] = useScreen<any>({ screenId })

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

  // console.log('Screens props', besignerUrl, props, status, screen)

  return (
    <>
      <NextPageTitle screen={'Screen Details'} />
      <DashboardLayout
        activeTab={buildRoute(Route.SCREEN_LIST)}
        breadcrumbItems={[
          {
            children: 'Screens',
            href: buildRoute(Route.SCREEN_LIST),
          },
          {
            children: `${screen?.displayName || 'Not Found'}`,
          },
        ]}
        header={{
          children: `${screen?.displayName || 'Not Found'}`,
          icon: { path: ICON_VARIANT_PAGES.path },
        }}
        headerRight={
          <AppLink
            size="large"
            variant="contained"
            componentVariant="button"
            href={besignerUrl}
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
        <ContainerComponent gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                xs: 12,
                md: 6,
                lg: 4,
                children: (
                  <WidgetCardComponent
                    header={'Basic Details'}
                    // contentGutterX
                    contentGutterY
                    contentBordered
                  >
                    <List dense disablePadding>
                      {details.map(
                        ({ primary, secondary, icon, ...item }, key) => (
                          <ListItem
                            key={item['key'] ?? item['id'] ?? key}
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
                  </WidgetCardComponent>
                ),
              },
              {
                xs: 12,
                md: 6,
                lg: 8,
                children: (
                  <WidgetCardComponent
                    header={'Raw JSON'}
                    contentGutterX
                    contentGutterY
                    contentBordered
                  >
                    <pre>{JSON.stringify(screen, null, 2)}</pre>
                  </WidgetCardComponent>
                ),
              },
            ]}
          />
        </ContainerComponent>
      </DashboardLayout>
    </>
  )
}
ScreenDetails.displayName = 'Page:ScreenDetails'
ScreenDetails.layouts = [AuthenticatedLayout, ConsoleLayout]
ScreenDetails.layoutProps = {
  ConsoleLayout: {
    title: 'Screen Details',
  },
}

export default ScreenDetails
