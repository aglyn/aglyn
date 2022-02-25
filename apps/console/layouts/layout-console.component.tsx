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

import {useThemeModeContext} from '@aglyn/shared-feature-themes'
import {
  mdiBrightness4,
  mdiBrightness5,
  mdiCogOutline,
  MdiIcon,
  mdiShieldLock,
} from '@aglyn/shared-ui-mdi-jsx'
import {_isArr} from '@aglyn/shared-util-guards'
import {Stack} from '@mui/material'
import MuiIconButton from '@mui/material/IconButton'
import MuiTooltip from '@mui/material/Tooltip'
// import {type CurrentUserContextType} from '../contexts/current-user-context'
// import {type AggregatedPageMeta} from '../lib/app-pages'
// import {tabItems} from '../lib/navigation-menus'
import LayoutAuthenticatedComponent from './layout-authenticated.component'
import LayoutMainComponent, {type LayoutMainProps} from './layout-main.component'


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
    ...rest
  } = props

  return (
    <LayoutMainComponent
      title={title ? [..._isArr(title) ? title : [title], 'Secure'] : 'Secure'}
      productName={'Console'}
      quickActionMenus={[
        {
          icon: {path: mdiCogOutline.path},
          // alt: '',
          items: [
            {
              dense: true,
              children: <ChangeThemeMenuItem />,
            },
          ],
        },
      ]}
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
