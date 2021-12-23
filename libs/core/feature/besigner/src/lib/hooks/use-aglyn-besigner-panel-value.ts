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

import {BesignerPanelsState} from '@aglyn/core-data-framework'
import {KeyOf} from '@aglyn/shared-data-types'
import {useMemo} from 'react'
import {useAglynBesignerStoreState} from './use-aglyn-besigner-store-state'


export const useAglynBesignerPanelValue = <P extends KeyOf<BesignerPanelsState>, K extends KeyOf<BesignerPanelsState[P]>>(
  item: P,
  key: K,
): BesignerPanelsState[P][K] => {
  const panel = useAglynBesignerStoreState('panels', item)
  const {[key]: value} = {...panel}

  return useMemo(() => value, [value, item, key])
}

export default useAglynBesignerPanelValue
