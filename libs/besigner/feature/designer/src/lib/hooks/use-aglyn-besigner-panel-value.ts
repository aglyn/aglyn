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
  type BesignerPanelKey,
  type BesignerPanelsState,
  setBesignerPanel,
} from '@aglyn/besigner'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { _isFnT } from '@aglyn/shared-util-tools'
import { useCallback } from 'react'
import useBesignerAppContext from './use-besigner-app-context'

export function useAglynBesignerPanelValue<
  P extends BesignerPanelKey,
  K extends keyof BesignerPanelsState[P],
>(
  panelName: P,
  key: K,
): [
  value: BesignerPanelsState[P][K] | undefined,
  setValue: (
    value:
      | BesignerPanelsState[P][K]
      | ((
          prev: BesignerPanelsState[P][K],
          panel: BesignerPanelsState[P],
          panels: BesignerPanelsState,
        ) => BesignerPanelsState[P][K]),
  ) => void,
] {
  const app = useBesignerAppContext()
  const setPanelValue = useAglynBesignerPanelSetValue<P, K>().bind(
    null,
    panelName,
    key,
  )
  const value = useSubscribable<BesignerPanelsState[P][K]>(
    app.interface?.panels,
    undefined,
    (panels) => panels?.[panelName]?.[key],
    [key, panelName, app],
  )

  return [value, setPanelValue]
}

export default useAglynBesignerPanelValue

export function useAglynBesignerPanelSetValue<
  P extends BesignerPanelKey,
  K extends keyof BesignerPanelsState[P],
>(): (
  panelName: P,
  key: K,
  value:
    | BesignerPanelsState[P][K]
    | ((
        prev: BesignerPanelsState[P][K],
        panel: BesignerPanelsState[P],
        panels: BesignerPanelsState,
      ) => BesignerPanelsState[P][K]),
) => void {
  const app = useBesignerAppContext()
  return useCallback(
    (
      panelName: P,
      key: K,
      value:
        | BesignerPanelsState[P][K]
        | ((
            prev: BesignerPanelsState[P][K],
            panel: BesignerPanelsState[P],
            panels: BesignerPanelsState,
          ) => BesignerPanelsState[P][K]),
    ) => {
      setBesignerPanel(app, {
        panel: panelName,
        value: (prev, panels) => ({
          ...prev,
          [key]: _isFnT(value) ? value(prev[key], prev, panels) : value,
        }),
      })
    },
    [app],
  )
}
