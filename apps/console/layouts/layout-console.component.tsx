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
  ICON_VARIANT_APP_SETTINGS,
  ICON_VARIANT_SIGN_OUT,
  ICON_VARIANT_THEME_DARK,
  ICON_VARIANT_THEME_LIGHT,
  ICON_VARIANT_THEME_SYSTEM,
  ICON_VARIANT_USER_SETTINGS,
} from '@aglyn/shared-data-enums'
import {getFirebaseAuth} from '@aglyn/shared-feature-fbclient'
import {useThemeMode} from '@aglyn/shared-feature-themes'
import {_isArr} from '@aglyn/shared-util-guards'
import {gravatarUrlFromEmail} from '@aglyn/shared-util-tools'
import {useAuthState} from 'react-firebase-hooks/auth'
import LayoutAuthenticatedComponent from './layout-authenticated.component'
import LayoutMainComponent, {type LayoutMainProps} from './layout-main.component'


const firebaseAuth = getFirebaseAuth()

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
  const [, toggleThemeMode, themeSetting] = useThemeMode()

  return (
    <LayoutMainComponent
      title={title ? [..._isArr(title) ? title : [title], 'Secure'] : 'Secure'}
      appBarSuffix="Console"
      quickActions={[
        ...quickActions || [],
        {
          icon: {path: ICON_VARIANT_APP_SETTINGS.path},
          MenuProps: {dense: true},
          // alt: '',
          items: [
            {
              onClick: toggleThemeMode,
              // component: 'button',
              children: themeSetting === 'light' ? 'Light theme'
                : themeSetting === 'dark' ? 'Dark theme'
                  : 'Default theme',
              icon: {
                path: themeSetting === 'dark' ? ICON_VARIANT_THEME_DARK.path
                  : themeSetting === 'light' ? ICON_VARIANT_THEME_LIGHT.path
                    : ICON_VARIANT_THEME_SYSTEM.path,
              },
              'aria-label': 'switch theme mode',

            },
          ],
        },
        {
          title: 'Manage account',
          MenuProps: {dense: true},
          sx: {p: 0.5},
          edge: 'end',
          avatar: {
            src: gravatarUrlFromEmail(user?.email),
          },
          items: [
            {
              children: 'Settings',
              href: '/account/settings',
              icon: {path: ICON_VARIANT_USER_SETTINGS.path},
            },
            {
              dividerOnly: true,
            },
            {
              children: 'Sign out',
              href: '/signout',
              icon: {path: ICON_VARIANT_SIGN_OUT.path},
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
