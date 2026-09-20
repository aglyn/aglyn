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

import {
  formatFunctionParameterOptions,
  type HostFunctionParameterOption,
  parseFunctionParameterOptions,
} from '@aglyn/aglyn'

/**
 * A parameter's choice list as one line of text (AGL-3202). The grammar lives
 * in core — `parseFunctionParameterOptions` — because the canvas's Function
 * Input element reads the same line and a plugin may not import another. These
 * are the names the function builder has always called it by.
 */
export function parseParameterOptions(
  text: string,
): HostFunctionParameterOption[] {
  return parseFunctionParameterOptions(text)
}

/** The inverse, for showing a stored list in that one line. */
export function formatParameterOptions(
  options: HostFunctionParameterOption[] | undefined,
): string {
  return formatFunctionParameterOptions(options)
}
