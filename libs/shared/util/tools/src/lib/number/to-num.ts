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

import { _isNumT } from '../guards/lib/_is-num-t'

type ToNumType = 'int' | 'float' | 'eval'
type ToNumResult<T extends ToNumType = never> = ConditionalNonDist<
  T,
  'eval',
  any,
  number
>

export type ToNumOptions<T extends ToNumType = never, N = 0> =
  | { onNaN?: N; type?: 'int'; radix?: number }
  | { onNaN?: N; type?: T; radix?: never }

/**
 * Ensure and parse any value to a number.
 *
 * - If radix, `{type: 'int'}` is provided will use {@link parseInt}
 * - If `{type: 'parse'}` is provided will use {@link parseFloat}
 * - If `{type: 'eval'}` is provided will use {@link eval} and {@link Number}
 * - Otherwise uses {@link Number|Number(val)}
 * - If parsing results in NaN will return {@link onNaN}.
 *
 * @param val - the value to parse into a number
 * @param options - override default parsing behavior
 */
export function toNum<T extends ToNumType, N = 0>(
  val: string | any,
  options?: ToNumOptions<T, N>,
): ToNumResult<T> | N {
  const { type, onNaN, radix } = { ...options }
  let parsed: ToNumResult<T> | N = NaN

  if (_isNumT(radix)) parsed = parseInt(val, radix)
  else if (type === 'int') parsed = parseInt(val)
  else if (type === 'float') parsed = parseFloat(val)
  else if (type === 'eval') parsed = Number(eval(val))
  else if (!type) parsed = Number(val)
  if (isNaN(parsed)) parsed = onNaN ?? 0

  return parsed
}
