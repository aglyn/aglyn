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

import { ErrorPayload } from './types'


export function replaceTemplate(stringTemplate, data: ErrorPayload, replacePattern?: RegExp): string {
  const pattern = replacePattern ?? replaceTemplate.DEFAULT_PATTERN
  return String(stringTemplate).replace(pattern, (_, key) => {
    const value = data[key]
    return value !== null ? String(value) : `<${key}?>`
  })
}
export namespace replaceTemplate {
  export const DEFAULT_PATTERN = /\{\$([^}]+)}/g
}
