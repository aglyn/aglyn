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

import {ICON_VARIANT_BESIGNER, ICON_VARIANT_PAGES} from '@aglyn/shared-data-enums'
import {AppLink, ContainerComponent, GridItems} from '@aglyn/shared-ui-jsx'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {ListItemText} from '@mui/material'
import {doc} from 'firebase/firestore'
import {useRouter} from 'next/router'
import {useFirestore, useFirestoreDocDataOnce} from 'reactfire'
import WidgetCardComponent from '../../../components/widget-card.component'
import {CONTENT_MAX_WIDTH} from '../../../constants/shared'
import LayoutConsoleComponent from '../../../layouts/layout-console.component'
import LayoutDashboardComponent from '../../../layouts/layout-dashboard.component'


export function ScreenDetails(props) {

  const {query} = useRouter()
  const screenId = query.screenId as string
  const firestore = useFirestore()
  const screenRef = doc(firestore, 'screens', `${screenId}`)
  const {status, data: screen} = useFirestoreDocDataOnce(screenRef, {
    idField: '$id', // this field will be added to the object created from each document
  })

  const details = [
    {
      id: 'details-dname',
      primary: 'Display name:',
      secondary: `${screen?.displayName ?? ''}`,
    },
    {
      id: 'details-desc',
      primary: 'Description:',
      secondary: `${screen?.description ?? ''}`,
    },
    {
      id: 'details-datec',
      primary: 'Date created:',
      secondary: `${screen?.createdAt?.toDate?.() || ''}`,
    },
    {
      id: 'details-dateu',
      primary: 'Date updated:',
      secondary: `${screen?.updatedAt?.toDate?.() || ''}`,
    },
  ]

  console.log('Screens props', props, status, screen)

  return (
    <LayoutDashboardComponent
      activeTab={'/screens'}
      breadcrumbItems={[
        {
          children: 'Screens',
          href: '/screens',
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
          variant="outlined"
          componentVariant="fab"
          href={'/screens/[screenId]/besigner'}
          hrefAs={`/screens/${screenId}/besigner`}
          title={'Open with besigner'}
        >
          <MdiIcon path={ICON_VARIANT_BESIGNER.path} />
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
                  contentGutterX
                  contentGutterY
                  contentBordered
                >
                  {details.map((item, i) => (
                    <ListItemText key={item.id ?? i} {...item} />
                  ))}
                </WidgetCardComponent>
              ),
            },
            {
              xs: 12, md: 6, lg: 8,
              children: (
                <WidgetCardComponent
                  header={'Basic Details'}
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
    </LayoutDashboardComponent>
  )
}
ScreenDetails.displayName = 'Page:ScreenDetails'
ScreenDetails.layoutComponent = LayoutConsoleComponent
ScreenDetails.layoutProps = {
  LayoutConsoleComponent: {
    title: 'Screen Details',
    disableAppBarElevation: true,
  },
}

export default ScreenDetails
