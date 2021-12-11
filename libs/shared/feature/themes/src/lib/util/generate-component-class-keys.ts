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


type PFX = 'Aglyn'
type Sep = '-'
type ClassKey<K extends string, P extends string = PFX> = `${P}${Sep}${K}`
const pfx: PFX = 'Aglyn'
const sep: Sep = '-'
const makeClassKey = <K extends string>(
  key: K,
  pre: PFX | string = pfx,
): ClassKey<K, typeof pre> => `${pre}${sep}${key}`

const globalStateClassesKeys = {
  active: makeClassKey('active'),
  checked: makeClassKey('checked'),
  completed: makeClassKey('completed'),
  disabled: makeClassKey('disabled'),
  error: makeClassKey('error'),
  expanded: makeClassKey('expanded'),
  focused: makeClassKey('focused'),
  focusVisible: makeClassKey('focusVisible'),
  hovered: makeClassKey('hovered'),
  required: makeClassKey('required'),
  selected: makeClassKey('selected'),
  wrapper: makeClassKey('wrapper'),
}
type GlobalStateClassesKey = keyof typeof globalStateClassesKeys
type GlobalStateClassesKeyClass<K extends GlobalStateClassesKey> = typeof globalStateClassesKeys[K]

function generateComponentClass<C extends string>(
  componentName: C,
  slot: string | GlobalStateClassesKey
) {
  if (slot in globalStateClassesKeys) {
    return globalStateClassesKeys[slot as GlobalStateClassesKey]
  }
  return makeClassKey(slot, componentName)
}

export function generateComponentClassKeys<T extends string>(
  componentName: string,
  slots: T[],
): Record<T, string> {
  const result: Record<string, string> = {}

  slots.forEach((slot) => {
    result[slot] = generateComponentClass(componentName, slot)
  })

  return result
}

export default generateComponentClassKeys
