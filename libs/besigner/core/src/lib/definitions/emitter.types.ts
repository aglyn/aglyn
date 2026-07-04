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

import type { PayloadData } from '@aglyn/aglyn'
import type {
  BesignerFlagsState,
  BesignerPanelKey,
  BesignerPanelsState,
} from '../definitions/besigner-interface.types'
import {
  BesignerFlagValue,
  BesignerPanelValue,
} from '../definitions/besigner-interface.types'

export type BesignerSetFlagPayload<K extends keyof BesignerFlagsState = any> =
  PayloadData<{
    flag: K
    value: (
      prev: BesignerFlagValue<K>,
      flags: BesignerFlagsState,
    ) => BesignerFlagValue<K>
  }>
export type BesignerSetFlagsPayload = PayloadData<{
  flags: (prev: BesignerFlagsState) => BesignerFlagsState
}>
export type BesignerSetPanelPayload<K extends BesignerPanelKey = any> =
  PayloadData<{
    panel: K
    value: (
      prev: BesignerPanelValue<K>,
      panels: BesignerPanelsState,
    ) => BesignerPanelValue<K>
  }>
export type BesignerSetPanelsPayload = PayloadData<{
  panels: (prev: BesignerPanelsState) => BesignerPanelsState
}>
