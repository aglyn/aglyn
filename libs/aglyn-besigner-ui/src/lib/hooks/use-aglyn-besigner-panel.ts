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
  type BesignerPanelItem,
  type BesignerPanelKey,
  type BesignerPanelsState,
  setBesignerPanel,
} from '@aglyn/besigner-data-app'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { _isFnT } from '@aglyn/shared-util-tools'
import { useCallback } from 'react'
import useBesignerAppContext from './use-besigner-app-context'

export function useAglynBesignerSetPanel(): (
  name: BesignerPanelKey,
  panel:
    | BesignerPanelItem
    | ((
        prev: BesignerPanelItem,
        panels: BesignerPanelsState,
      ) => BesignerPanelItem),
) => void {
  const app = useBesignerAppContext()
  return useCallback(
    (
      name: BesignerPanelKey,
      panel:
        | BesignerPanelItem
        | ((
            prev: BesignerPanelItem,
            panels: BesignerPanelsState,
          ) => BesignerPanelItem),
    ) => {
      setBesignerPanel(app, {
        panel: name,
        value: (prev, panels) => (_isFnT(panel) ? panel(prev, panels) : panel),
      })
    },
    [app],
  )
}

export function useAglynBesignerPanel(
  name: BesignerPanelKey,
): [
  value: BesignerPanelItem | undefined,
  setValue: (
    panel:
      | BesignerPanelItem
      | ((
          prev: BesignerPanelItem,
          panels: BesignerPanelsState,
        ) => BesignerPanelItem),
  ) => void,
] {
  const app = useBesignerAppContext()
  const value = useSubscribable<BesignerPanelItem | undefined>(
    app?.interface?.panels,
    undefined,
    (panels) => panels?.[name],
    [name, app],
  )
  const setPanel = useAglynBesignerSetPanel().bind(null, name)

  return [value, setPanel]
}

export default useAglynBesignerPanel
