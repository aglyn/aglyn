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

const globalStateClassesMapping: Record<string, string> = {
  active: 'Aglyn-active',
  checked: 'Aglyn-checked',
  completed: 'Aglyn-completed',
  disabled: 'Aglyn-disabled',
  error: 'Aglyn-error',
  expanded: 'Aglyn-expanded',
  focused: 'Aglyn-focused',
  focusVisible: 'Aglyn-focusVisible',
  required: 'Aglyn-required',
  selected: 'Aglyn-selected',
  wrapper: 'Aglyn-wrapper',
};

export function generateUtilityClass(componentName: string, slot: string): string {
  const globalStateClass = globalStateClassesMapping[slot];
  return globalStateClass || `${componentName}-${slot}`;
}

export function generateUtilityClasses<T extends string>(
  componentName: string,
  slots: T[],
): Record<T, string> {
  const result: Record<string, string> = {}

  slots.forEach((slot) => {
    result[slot] = generateUtilityClass(componentName, slot)
  })

  return result
}

export default generateUtilityClasses
