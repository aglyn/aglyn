/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { APP_CONSOLE, IS_PRODUCTION } from '@aglyn/shared-data-enums'
import { _AppComponent, type _AppProps } from '@aglyn/shared-ui-next'
import {
  consoleThemeDark,
  consoleThemeLight,
  createWithThemeProvider,
} from '@aglyn/shared-ui-theme'
import { Fragment } from 'react'

// enableStaticRendering(true)
const withThemeProvider = createWithThemeProvider({
  theme: [consoleThemeLight, consoleThemeDark],
})

const MainComponent = withThemeProvider((props: any) => {
  const { children } = props

  return (
    <>
      {children}
      {/*<HostProvider>{children}</HostProvider>*/}
    </>
  )
})

function _App<Props, Initial>(props: _AppProps<Props, Initial>) {
  const { headChildren, ...rest } = props

  return (
    <_AppComponent
      MainComponent={MainComponent}
      metaElements={[
        ['viewport', 'width=device-width, initial-scale=1'],
        ['description', APP_CONSOLE.DESCRIPTION],
      ]}
      headChildren={
        <Fragment>
          {!IS_PRODUCTION ? null : <Fragment></Fragment>}
          {headChildren}
        </Fragment>
      }
      {...rest}
    />
  )
}
_App.displayName = '_App'
export default _App
