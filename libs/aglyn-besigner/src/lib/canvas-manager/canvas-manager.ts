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

import * as Aglyn from '@aglyn/aglyn'
import { observable } from 'mobx'
import type { RefObject } from 'react'

export enum EditorMode { //BesignerDeviceFlag
  SELECT = 0x1,
  REARRANGE = 0x2,
  PREVIEW = 0x3,
}

export const refs = observable.map<Aglyn.NodeId, RefObject<HTMLElement>>(
  {},
  { deep: false },
)
export const handles = observable.map<Aglyn.NodeId, JSX.AnyProps>(
  {},
  { deep: false },
)
