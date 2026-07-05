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


// https://github.com/JamesMGreene/Function.name/blob/58b314d4a983110c3682f1228f845d39ccca1817/Function.name.js#L3
export const fnNameMatchRegex = /^\s*function(?:\s|\s*\/\*.*\*\/\s*)+([^(\s/]*)\s*/
export const getPureFunctionName = (fn: any) => {
  const match = `${fn}`.match(fnNameMatchRegex)
  const name = match && match[1]
  return name || ''
}

/**
 *
 */
export const getFunctionComponentName = (Component: { displayName?: string; name?: string }, fallback = 'fn') => (
  Component.displayName
  || Component.name
  || getPureFunctionName(Component)
  || fallback
)

export const getWrappedComponentName = (outerType: { displayName?: string }, innerType: { displayName?: string; name?: string }, wrapperName: string) => {
  const functionName = getFunctionComponentName(innerType)
  return (
    outerType.displayName
    || (
      functionName !== ''
        ? `${wrapperName}(${functionName})`
        : wrapperName
    )
  )
}

/**
 * Get the display name of a function, react component, object, or string
 * @example getDisplayName('hello') => 'hello'
 * @example getDisplayName(null, 'N/A') => 'N/A'
 * @example getDisplayName(getCount) => 'getCount'
 * @example getDisplayName(class MyComp {displayName = 'My'}) => 'My'
 * @example
 * MyComp = () => {...};
 * MyComp.displayName = 'MyComp'
MyComp.aglyn = true;
 * MyComp = forwardRef(MyComp)
 * getDisplayName(MyComp) => 'My'
 */
export function getDisplayName(fn: any, fallback = 'Component'): string {
  if (fn == null) {
    return fallback
  }

  if (typeof fn === 'string') {
    return fn
  }

  if (typeof fn === 'function') {
    return getFunctionComponentName(fn, fallback)
  }

  if (typeof fn === 'object') {
    switch (fn.$$typeof) {

      case Symbol.for('react.forward_ref') || 0xead0:
        return getWrappedComponentName(fn, fn.render, 'ForwardRef')

      default:
        return fallback
    }
  }

  return fallback
}

export default getDisplayName
