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
import {AppLink, ContainerComponent, GridItems, useLoading} from '@aglyn/shared-ui-jsx'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {useNextPageTitle} from '@aglyn/shared-ui-next'
import {useSnackbar} from '@aglyn/shared-ui-snackstack'
import {List, ListItem, ListItemIcon, ListItemText} from '@mui/material'
import {doc} from 'firebase/firestore'
import {useRouter} from 'next/router'
import {useEffect} from 'react'
import {useFirestore, useFirestoreDoc, useFirestoreDocData} from 'reactfire'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import ConsoleLayout from '../../../../../../components/layouts/console.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import WidgetCardComponent from '../../../../../../components/widget-card.component'
import {buildRoute, Route} from '../../../../../../constants/route-links'
import {CONTENT_MAX_WIDTH} from '../../../../../../constants/shared'


const whiteSpace = '--'

function ScreenDetails(props) {
  useNextPageTitle({screen: 'Screen Details'})

  const {query} = useRouter()
  const screenId = `${query.screenId}`
  const versionId = `${query.versionId}`
  const firestore = useFirestore()
  const screenRef = doc(firestore, 'screens', screenId)
  const {queueLoading} = useLoading()
  const docData2 = useFirestoreDoc(screenRef, {idField: '$id'})
  const docData = useFirestoreDocData(screenRef, {idField: '$id'})
  const {status, data: screen} = docData
  const besignerUrl = buildRoute(Route.SCREEN_BESIGNER, {screenId, versionId})
  const {enqueueSnackbar, closeSnackbar} = useSnackbar()

  console.log('docData', docData)
  console.log('docData2', docData2)

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
      id: 'details-id',
      primary: 'Screen ID:',
      secondary: screen?.$id,
      icon: {path: ICON_VARIANT_PRIMARY_KEY.path},
    },
    {
      key: 'displayName',
      id: 'details-dname',
      primary: 'Display name:',
      secondary: screen?.displayName,
      icon: {path: ICON_VARIANT_TEXT.path},
    },
    {
      key: 'description',
      id: 'details-desc',
      primary: 'Description:',
      secondary: screen?.description,
      icon: {path: ICON_VARIANT_TEXT.path},
    },
    {
      key: 'dateCreated',
      id: 'details-datec',
      primary: 'Date created:',
      secondary: screen?.createdAt?.toDate?.()?.toLocaleString(),
      icon: {path: ICON_VARIANT_DATE_TIME.path},
    },
    {
      key: 'dateUpdated',
      id: 'details-dateu',
      primary: 'Last updated:',
      secondary: screen?.updatedAt?.toDate?.()?.toLocaleString(),
      icon: {path: ICON_VARIANT_DATE_TIME.path},
    },
    {
      key: 'dateDeleted',
      id: 'details-dated',
      primary: 'Date deleted:',
      secondary: screen?.deletedAt?.toDate?.()?.toLocaleString(),
      icon: {path: ICON_VARIANT_DATE_TIME.path},
    },
    {
      key: 'versionId',
      id: 'details-vers',
      primary: 'Version ID:',
      secondary: screen?.versionId,
      icon: {path: ICON_VARIANT_IDENTIFIER.path},
    },
  ]

  console.log('Screens props', besignerUrl, props, status, screen)

  return (
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
        icon: {path: ICON_VARIANT_PAGES.path},
      }}
      headerRight={(
        <AppLink
          size="small"
          variant="extended"
          componentVariant="fab"
          href={besignerUrl}
          title={'Open with besigner'}
          disabled={status !== 'success' || !screen}
        >
          <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} sx={{mr: 0.5}} />
          Besigner
        </AppLink>
      )}
    >
      <ContainerComponent gutterY maxWidth={CONTENT_MAX_WIDTH}>

        <GridItems
          spacing={3}
          items={[
            {
              xs: 12, md: 6, lg: 4,
              children: (
                <WidgetCardComponent
                  header={'Basic Details'}
                  // contentGutterX
                  contentGutterY
                  contentBordered
                >
                  <List
                    dense
                    disablePadding
                  >
                    {details.map(({primary, secondary, icon, ...item}, key) => (
                      <ListItem
                        key={item.key ?? item.id ?? key}
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
                    ))}
                  </List>
                </WidgetCardComponent>
              ),
            },
            {
              xs: 12, md: 6, lg: 8,
              children: (
                <WidgetCardComponent
                  header={'Raw JSON'}
                  contentGutterX
                  contentGutterY
                  contentBordered
                >
                  <pre>
                  {JSON.stringify(screen, null, 2)}
                  </pre>
                </WidgetCardComponent>
              ),
            },
          ]}
        />


      </ContainerComponent>
    </DashboardLayout>
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
