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

import { deepMerge } from '@aglyn/shared/util/helpers'


export type HandlePropsOptions = {
  clone?: boolean
  callback?: (key: string, options?: HandlePropsOptions) => ((x: any, y: any) => any) | undefined
}

/**
 * Handle deep merging props
 * @param {Partial<T>} props
 * @param {Partial<T>} defaults
 * @param {HandlePropsOptions} options
 * @returns {T}
 */
export function handleElementPropDefaults<T>(props: Partial<T>, defaults: Partial<T>, options?: HandlePropsOptions): T
/**
 * Handle deep merging props
 * @param {Partial<T1>} props
 * @param {Partial<T2>} defaults
 * @param {HandlePropsOptions} options
 * @returns {T1 & T2}
 */
export function handleElementPropDefaults<T1, T2>(props: Partial<T1>, defaults: Partial<T2>, options?: HandlePropsOptions): T1 & T2 {
  return deepMerge(defaults, props, options)
}

export default handleElementPropDefaults
