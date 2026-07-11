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

import { APP_WWW, IS_PRODUCTION } from '@aglyn/shared-data-enums'
import {
  _AppComponent,
  type _AppProps,
} from '@aglyn/shared-ui-next/components/_app.component'
import {
  consoleThemeDark,
  consoleThemeLight,
  createWithThemeProvider,
} from '@aglyn/shared-ui-theme'
import { Fragment } from 'react'
import HsEmbedScript from '../components/hs-embed-script'
import VisitorQueueScript from '../components/visitor-queue-script'
import { withAppController } from '@aglyn/shared-util-fbclient'

let app
if (!app) {
  const previewProduction = true
  app = withAppController(
    IS_PRODUCTION || previewProduction
      ? {}
      : {
          authEmulator: 'http://localhost:9099/',
          firestoreEmulator: { host: 'localhost', port: 8082 },
        },
  )
}
const withThemeProvider = createWithThemeProvider({
  theme: [consoleThemeLight, consoleThemeDark],
})

const MainComponent = withThemeProvider((props: any) => {
  const { children } = props

  return <>{children}</>
})

function _App<Props, InitialProps>(props: _AppProps<Props, InitialProps>) {
  const { headChildren, ...rest } = props

  return (
    <_AppComponent
      MainComponent={MainComponent}
      meta={[
        {
          key: 'viewport',
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        { key: 'desc', name: 'description', content: APP_WWW.DESCRIPTION },
      ]}
      headChildren={
        <Fragment>
          {!IS_PRODUCTION ? null : (
            <Fragment>
              <HsEmbedScript />
              <VisitorQueueScript />
            </Fragment>
          )}
          {headChildren}
        </Fragment>
      }
      {...rest}
    />
  )
}
_App.displayName = '_App'
export default _App
