/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { AglynAppController, AppUUN, DEFAULT_APP_UUN, getApp } from '@aglyn/core-data-framework'
import { createContext, memo, ReactNode, useContext, useState } from 'react'

export interface IAglynAppContext {
  getApp: (appName?: AppUUN) => AglynAppController
}

export const AglynAppContext = createContext<IAglynAppContext>({
  getApp,
})
AglynAppContext.displayName = 'AglynAppContext'

export const {
  Provider: AglynAppContextProvider,
  Consumer: AglynAppContextConsumer,
  displayName: aglynAppContextDisplayName,
} = AglynAppContext
export default AglynAppContext

export const useAglynAppContext = () => {
  return useContext(AglynAppContext)
}

export interface AglynAppContextComponentProps {
  appName?: AppUUN
  children?: ReactNode
}

function AglynAppContextComponentRaw(props: AglynAppContextComponentProps) {
  const { appName, children } = props
  const [value] = useState(() => ({
    getApp: (appNameOverride?: AppUUN) => {
      return getApp(appNameOverride || appName)
    },
  }))

  return <AglynAppContextProvider value={value}>{children}</AglynAppContextProvider>
}
AglynAppContextComponentRaw.displayName = 'AglynAppContextComponent'
AglynAppContextComponentRaw.defaultProps = {
  appName: DEFAULT_APP_UUN,
}

export const AglynAppContextComponent = memo(AglynAppContextComponentRaw)
