/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { observable, runInAction } from 'mobx'

/** One Attributes field to bring into view for one element. */
export interface AttributeFocusRequest {
  nodeId: string
  /** The field's form name, as the Attributes form registers it. */
  field: string
}

/**
 * A field the canvas has asked the Attributes panel to show, until the panel
 * has shown it.
 *
 * Something on the canvas that names a setting — a repeat badge saying its
 * dataset is missing — is only useful if acting on it lands on that setting.
 * Selecting the element alone left the author looking at a panel of fields
 * with no idea which one the badge meant.
 */
export const attributeFocusRequest = observable.box<AttributeFocusRequest | null>(
  null,
  { deep: false },
)

export function requestAttributeFocus(nodeId: string, field: string): void {
  runInAction(() => attributeFocusRequest.set({ nodeId, field }))
}

export function clearAttributeFocusRequest(): void {
  runInAction(() => attributeFocusRequest.set(null))
}
