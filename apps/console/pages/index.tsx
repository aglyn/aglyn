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

import {getFirebaseAuth} from '@aglyn/shared-feature-fbclient'
import {GridButtons} from '@aglyn/shared-ui-jsx'
import {mdiBug, mdiHome, MdiIcon, mdiShieldLock} from '@aglyn/shared-ui-mdi-jsx'
import styled from '@emotion/styled'
import {Stack} from '@mui/material'
import {useAuthState} from 'react-firebase-hooks/auth'
import LayoutAuthenticatedComponent from '../layouts/layout-authenticated.component'
import LayoutConsoleComponent from '../layouts/layout-console.component'


const firebaseAuth = getFirebaseAuth()
const StyledPage = styled.div`
  .page {
  }
`

export function Index() {
  const [user, loading, error] = useAuthState(firebaseAuth)
  /*
   * Replace the elements below with your own.
   *
   * Note: The corresponding styles are in the ./index.@emotion/styled file.
   */
  return (
    <LayoutConsoleComponent
      title={'My Dashboard'}
      tabBarTitle={(
        <Stack
          direction="row"
          spacing={{sm: 0.15, md: 0.5}}
          alignItems="center"
          typography={'subtitle2'}
          lineHeight={'normal'}
          sx={{color: 'tertiary.light'}}
        >
          <span>
            {'Secure'}
          </span>
          <MdiIcon
            path={mdiShieldLock.path}
            fontSize={'small'}
            sx={{color: 'tertiary.light'}}
          />
        </Stack>
      )}
      header={{
        children: 'My Dashboard',
        icon: {path: mdiHome.path},
      }}
      breadcrumbItems={[
        {
          id: 'home',
          children: 'Home',
          href: '/',
        },
      ]}
      navTabItems={[
        {
          id: 'dashboard',
          label: 'Dashboard',
          href: '/',
        },
        {
          id: 'besigner',
          label: 'Besigner',
          href: '/besigner',
        },
      ]}
    >
      <StyledPage>
        <h2>Resources &amp; Tosols</h2>
        <p>Thank you for using and showing some ♥ for Nx.</p>
        <div>
          User: <pre>{JSON.stringify(user, null, 2)}</pre>
          Loading: <pre>{JSON.stringify(loading, null, 2)}</pre>
          Error: <pre>{JSON.stringify(error, null, 2)}</pre>
        </div>
        <MdiIcon path={mdiBug.path} />
        <GridButtons
          items={[
            {
              GridItemProps: {
                xs: 6,
              },
              children: 'Hello Button 1',
              variant: 'contained',
              color: 'primary',
              fullWidth: true,
            },
            {
              GridItemProps: {
                xs: 3,
              },
              children: 'Hello Button 1',
              variant: 'contained',
              color: 'primary',
              fullWidth: true,
            },
            {
              GridItemProps: {
                xs: 3,
              },
              children: 'Hello Button 1',
              variant: 'contained',
              color: 'primary',
              fullWidth: true,
            },
          ]}
        />
      </StyledPage>
    </LayoutConsoleComponent>
  )
}
Index.displayName = 'Page:Index'
Index.layoutComponent = LayoutAuthenticatedComponent

export default Index
