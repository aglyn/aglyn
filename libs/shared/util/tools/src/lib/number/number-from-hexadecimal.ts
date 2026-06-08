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

import {toNum} from './to-num'


/**
 * Convert Base16/Hexadecimal string to its decimal/number equivalent
 *
 * @param hex - 8-bit hexadecimal string
 * @returns the hexadecimal as a number
 */
export function numberFromHexadecimal(hex: string): number {
  return toNum(hex, {radix: 16})
}
export default numberFromHexadecimal
