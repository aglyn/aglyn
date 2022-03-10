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
  ICON_VARIANT_SIGN_OUT,
  ICON_VARIANT_THEME_DARK,
  ICON_VARIANT_THEME_LIGHT,
  ICON_VARIANT_THEME_SYSTEM,
  ICON_VARIANT_USER_SETTINGS,
} from '@aglyn/shared-data-enums'
import {useThemeMode} from '@aglyn/shared-feature-themes'
import {AppLink} from '@aglyn/shared-ui-jsx'
import {_isArr} from '@aglyn/shared-util-guards'
import {gravatarUrlFromEmail} from '@aglyn/shared-util-tools'
import {useUser} from 'reactfire'
import LayoutAuthenticatedComponent from './layout-authenticated.component'
import LayoutMainComponent, {type LayoutMainProps} from './layout-main.component'


export interface LayoutConsoleProps extends LayoutMainProps {
}

function LayoutConsoleComponent(props: LayoutConsoleProps) {
  const {
    title,
    children,
    quickActions,
    centerNavigationItems,
    ...rest
  } = props
  const {data: user} = useUser()
  const [, toggleThemeMode, themeSetting] = useThemeMode()
  const friendlyThemeMode = themeSetting === 'light' || themeSetting === 'dark'
    ? themeSetting
    : 'device default'

  return (
    <LayoutMainComponent
      title={title ? [..._isArr(title) ? title : [title], 'Secure'] : 'Secure'}
      appBarSuffix="Console"
      centerNavigationItems={[
        {
          id: 'center-nav-home',
          children: 'Home',
          href: '/',
        },
        {
          id: 'center-nav-besigner',
          children: 'Besigner',
          href: '/besigner',
        },
        ...centerNavigationItems || [],
      ]}
      quickActions={[
        ...quickActions || [],
        {
          title: 'Manage account',
          MenuProps: {dense: true, horizontalOrigin: 'right'},
          sx: {p: 0.5},
          edge: 'end',
          avatar: {
            src: user?.photoURL || gravatarUrlFromEmail(user?.email),
          },
          items: [
            {
              onClick: toggleThemeMode,
              // component: 'button',
              children: `Theme mode: ${friendlyThemeMode}`,
              icon: {
                path: themeSetting === 'dark' ? ICON_VARIANT_THEME_DARK.path
                  : themeSetting === 'light' ? ICON_VARIANT_THEME_LIGHT.path
                    : ICON_VARIANT_THEME_SYSTEM.path,
              },
              'aria-label': 'switch theme mode',
            },
            {
              children: 'Settings',
              component: AppLink,
              href: '/account/settings',
              icon: {path: ICON_VARIANT_USER_SETTINGS.path},
            },
            {
              type: 'divider',
            },
            {
              children: 'Sign out',
              component: AppLink,
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
