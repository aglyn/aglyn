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
import { Theme, Shadows } from '../../vendor/mui'


export function createInsetShadows<K extends number>(theme: Theme): Theme {
  const insetShadows: Shadows = theme.insetShadows ??= [] as unknown as Shadows

  for (const shadow of theme.shadows) {
    if (shadow === 'none') {
      insetShadows.push(shadow)
      continue
    }
    insetShadows.push(`inset ${shadow.split('),').join('),inset ')}`)
  }
  return theme
}
export default createInsetShadows
