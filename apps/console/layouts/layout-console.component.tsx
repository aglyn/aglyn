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
import {useThemeModeContext} from '@aglyn/shared-feature-themes'
import {mdiBrightness4, mdiBrightness5, mdiCog, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {_isArr} from '@aglyn/shared-util-guards'
import {gravatarUrlFromEmail} from '@aglyn/shared-util-tools'
import {IconButton as MuiIconButton, Tooltip as MuiTooltip} from '@mui/material'
import {useAuthState} from 'react-firebase-hooks/auth'
import LayoutAuthenticatedComponent from './layout-authenticated.component'
import LayoutMainComponent, {type LayoutMainProps} from './layout-main.component'


const firebaseAuth = getFirebaseAuth()

function ChangeThemeMenuItem(props) {
  const [mode, toggleThemeMode] = useThemeModeContext()
  return (
    <>
      {'Theme mode'}
      <MuiTooltip
        aria-label="switch theme scheme colors"
        title={
          mode === 'dark'
            ? 'Light mode'
            : 'Dark mode'
        }
      >
        <MuiIconButton onClick={toggleThemeMode as any}>
          <MdiIcon
            path={
              mode === 'dark'
                ? mdiBrightness4.path
                : mdiBrightness5.path
            }
          />
        </MuiIconButton>
      </MuiTooltip>
    </>
  )
}

export interface LayoutConsoleProps extends LayoutMainProps {
}

function LayoutConsoleComponent(props: LayoutConsoleProps) {
  const {
    title,
    children,
    quickActions,
    ...rest
  } = props
  const [user] = useAuthState(firebaseAuth)

  return (
    <LayoutMainComponent
      title={title ? [..._isArr(title) ? title : [title], 'Secure'] : 'Secure'}
      appBarSuffix="Console"
      quickActions={[
        ...quickActions || [],
        {
          icon: {path: mdiCog.path},
          // alt: '',
          items: [
            {
              dense: true,
              children: <ChangeThemeMenuItem />,
            },
          ],
        },
        {
          title: 'User account',
          avatar: {
            title: user?.displayName || 'No name',
            src: gravatarUrlFromEmail(user?.email),
          },
          items: [
            {
              dense: true,
              children: 'Account Settings',
              href: '/settings/account',
            },
          ],
        },
      ]}
      {...rest}
    >
      {children}
    </LayoutMainComponent>
  )
}

LayoutConsoleComponent.displayName = 'LayoutConsoleComponent'
LayoutConsoleComponent.defaultProps = {}
LayoutConsoleComponent.layoutComponent = LayoutAuthenticatedComponent

export {LayoutConsoleComponent}
export default LayoutConsoleComponent
