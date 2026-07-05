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

type PFX = 'Aglyn'
type Sep = '-'
export type ElementClass<
  ClassKey extends string,
  Prefix extends string = PFX
> = `${Prefix}${Sep}${ClassKey}`
export type GlobalClassKey = keyof typeof globalClassKey
export type GlobalElementClass<ClassKey extends GlobalClassKey = GlobalClassKey> =
  ElementClass<ClassKey>
export type ComponentClass<
  ClassKey extends string,
  Prefix extends string
> = ClassKey extends GlobalClassKey ? GlobalElementClass<ClassKey> : ElementClass<ClassKey, Prefix>

export type ClassKeyMap<ClassKey extends string, Prefix extends string> = {
  [P in ClassKey]: ComponentClass<P, Prefix>
}

const pfx: PFX = 'Aglyn'
const sep: Sep = '-'

export const globalClassKey = {
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

function makeClassKey<ClassKey extends string, Prefix extends string>(key: ClassKey, pre?: Prefix) {
  if (pre) return `${pre}${sep}${key}` as ElementClass<ClassKey, Prefix>
  return `${pfx}${sep}${key}` as ElementClass<ClassKey, PFX>
}

function generateComponentClass<ClassKey extends string, Prefix extends string>(
  key: ClassKey,
  componentName: Prefix
) {
  if (key in globalClassKey) {
    return globalClassKey[key as GlobalClassKey] as ComponentClass<ClassKey, PFX>
  }
  return makeClassKey(key, componentName) as ComponentClass<ClassKey, Prefix>
}

export function generateComponentClassKeys<
  ClassKey extends string | GlobalClassKey,
  Prefix extends string
>(componentName: Prefix, classKeys: ClassKey[]) {
  const result = {} as ClassKeyMap<ClassKey, Prefix>

  classKeys.forEach((key) => {
    Object.assign(result, { [key]: generateComponentClass(key, componentName) })
  })

  return result
}

export default generateComponentClassKeys
