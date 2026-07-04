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
  type BesignerFlagKey,
  type BesignerFlagsState,
  type BesignerFlagValue,
  setBesignerFlag,
} from '@aglyn/besigner'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { _isFnT } from '@aglyn/shared-util-tools'
import { useCallback } from 'react'
import useBesignerAppContext from './use-besigner-app-context'

export function useAglynBesignerFlag<K extends BesignerFlagKey>(
  flag: K,
): [
  value: BesignerFlagValue<K>,
  setValue: (
    value:
      | BesignerFlagValue<K>
      | ((
          prev: BesignerFlagValue<K>,
          flags: BesignerFlagsState,
        ) => BesignerFlagValue<K>),
  ) => void,
] {
  const app = useBesignerAppContext()
  const setFlag = useAglynBesignerSetFlag().bind(null, flag)
  const value = useSubscribable<BesignerFlagValue<K>>(
    app.interface?.flags,
    undefined,
    (flags) => flags?.[flag],
    [flag, app],
  )

  return [value, setFlag]
}

export default useAglynBesignerFlag

export function useAglynBesignerSetFlag<K extends BesignerFlagKey>(): (
  flag: K,
  value:
    | BesignerFlagValue<K>
    | ((
        prev: BesignerFlagValue<K>,
        flags: BesignerFlagsState,
      ) => BesignerFlagValue<K>),
) => void {
  const app = useBesignerAppContext()
  return useCallback(
    (
      flag: K,
      value:
        | BesignerFlagValue<K>
        | ((
            prev: BesignerFlagValue<K>,
            flags: BesignerFlagsState,
          ) => BesignerFlagValue<K>),
    ) => {
      setBesignerFlag(app, {
        flag: flag,
        value: (prev, flags) => (_isFnT(value) ? value(prev, flags) : value),
      })
    },
    [app],
  )
}
