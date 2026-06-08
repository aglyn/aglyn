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

export interface ChildrenFunctionPropProps<T = any> {
  childrenProp?: JSX.Children | ((...props: T[]) => JSX.Children)
  args?: T[] | T
}

export const ChildrenFunctionProp = <T,>(
  props: ChildrenFunctionPropProps<T>,
) => {
  const { childrenProp, args = [] } = props
  const arg = Array.isArray(args) ? args : args ? [args] : []

  return (
    <>
      {typeof childrenProp !== 'function' ? childrenProp : childrenProp(...arg)}
    </>
  )
}
ChildrenFunctionProp.displayName = 'ChildrenFunctionProp'

export default ChildrenFunctionProp
