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
  type AppUUN,
  CanvasSetElementsPayload,
  DEFAULT_APP_UUN,
  getApp as getAglynApp,
  type IAglynAppController,
  setCanvasElements,
} from '@aglyn/core-data-framework'
import {createContext, type ReactNode, useCallback, useContext, useEffect} from 'react'


export interface IAglynAppContext {
  getApp: (appName?: AppUUN) => IAglynAppController
}

export const AglynAppContext = createContext<IAglynAppContext>({
  getApp: getAglynApp,
})
AglynAppContext.displayName = 'AglynAppContext'
AglynAppContext.aglyn = true

export const {
  Provider: AglynAppContextProvider,
  Consumer: AglynAppContextConsumer,
} = AglynAppContext
export default AglynAppContext

export const useAglynAppContext = () => {
  return useContext(AglynAppContext)
}

export interface AglynAppContextComponentProps {
  appName?: AppUUN
  children?: ReactNode
  canvasElements?: CanvasSetElementsPayload
}

function AglynAppContextComponent(props: AglynAppContextComponentProps) {
  const {appName, children, canvasElements} = props

  const getApp = useCallback((overrideName?: AppUUN): IAglynAppController => {
    return getAglynApp(overrideName ?? appName)
  }, [appName])


  useEffect(() => {
    if (canvasElements) {
      setCanvasElements(getApp(), canvasElements)
    }
  }, [getApp, canvasElements])

  return (
    <AglynAppContextProvider value={{getApp}}>
      {children}
    </AglynAppContextProvider>
  )
}
AglynAppContextComponent.displayName = 'AglynAppContextComponent'
AglynAppContextComponent.aglyn = true
AglynAppContextComponent.defaultProps = {
  appName: DEFAULT_APP_UUN,
}

export {AglynAppContextComponent}
