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

import { deepmergeCustom } from 'deepmerge-ts'

export {
  deepmerge as objectDeepMerge,
  deepmergeCustom as objectDeepMergeCustom,
  type DeepMergeOptions as ObjectDeepMergeOptions,
} from 'deepmerge-ts'

/**
 * Deep merge where a later array REPLACES an earlier one rather than being
 * concatenated onto it.
 *
 * `objectDeepMerge` concatenates, which is right for accumulating lists and
 * wrong for configuration: merging `{ variants: ['a','b'] }` with
 * `{ variants: ['z'] }` should leave `['z']`, not `['a','b','z']` — nobody
 * overriding a setting means "append to the one I'm replacing". Reach for
 * this whenever the objects are config (theme options, plugin manifests,
 * settings documents) rather than data being collected.
 *
 * Non-plain values — functions, class instances — are replaced wholesale by
 * the later operand, which is what config overrides want too.
 */
export const objectDeepMergeReplaceArrays = deepmergeCustom({
  mergeArrays: false,
})

import objectDeepMergeFillIn from 'mout/object/deepFillIn'
export { objectDeepMergeFillIn }

// export function objectDeepMerge<T>(x: Partial<T>, y: Partial<T>, options?: DeepMergeOptions): T
// export function objectDeepMerge<T1, T2>(x: Partial<T1>, y: Partial<T2>, options?:
// DeepMergeOptions): T1 & T2 export function objectDeepMerge<T, K extends keyof any>(objects:
// Record<K, T>[], options?: Options): object export function objectDeepMerge<T>(objects:
// Partial<T>[], options?: Options): T
