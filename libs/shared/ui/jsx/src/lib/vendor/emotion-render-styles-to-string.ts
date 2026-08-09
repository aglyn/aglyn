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

/**
 * Vendored `renderStylesToString` from `@emotion/server@11.11.0`
 * (`create-instance`, MIT © Emotion team), bound to the default
 * `@emotion/css` cache exactly like the package's top-level entry.
 *
 * Why vendored (AGL-1238): `@emotion/server`'s entry modules import
 * `through`, `multipipe` and `html-tokenize` unconditionally, even though
 * only `renderStylesToNodeStream` needs them. In a client bundle that
 * chain pulls Node's `stream` → `next/dist/compiled/stream-browserify` →
 * `next/dist/compiled/util`, whose vendored `is-generator-function` probe
 * runs `Function("return function*() {}")` and trips the enforcing CSP
 * (`script-src`/eval) on every page. This port is stream-free, so none of
 * that reaches the browser. Behaviour is a faithful line-for-line port.
 */

import { cache } from '@emotion/css'

const generateStyleTag = (
  cssKey: string,
  ids: string,
  styles: string,
  nonceString: string,
) => `<style data-emotion="${cssKey} ${ids}"${nonceString}>${styles}</style>`

export function renderStylesToString(html: string): string {
  // The package sets this when the server instance is created.
  if (cache.compat !== true) cache.compat = true
  const nonceString =
    cache.nonce !== undefined ? ` nonce="${cache.nonce}"` : ''
  const { inserted, key: cssKey, registered } = cache
  const regex = new RegExp(`<|${cssKey}-([a-zA-Z0-9-_]+)`, 'gm')
  const seen: Record<string, boolean> = {}
  let result = ''
  let globalIds = ''
  let globalStyles = ''

  for (const id in inserted) {
    // eslint-disable-next-line no-prototype-builtins
    if (inserted.hasOwnProperty(id)) {
      const style = inserted[id]
      const key = `${cssKey}-${id}`
      if (style !== true && registered[key] === undefined) {
        globalStyles += style
        globalIds += ` ${id}`
      }
    }
  }

  if (globalStyles !== '') {
    result = generateStyleTag(
      cssKey,
      globalIds.substring(1),
      globalStyles,
      nonceString,
    )
  }

  let ids = ''
  let styles = ''
  let lastInsertionPoint = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(html)) !== null) {
    if (match[0] === '<') {
      if (ids !== '') {
        result += generateStyleTag(cssKey, ids.substring(1), styles, nonceString)
        ids = ''
        styles = ''
      }
      result += html.substring(lastInsertionPoint, match.index)
      lastInsertionPoint = match.index
      continue
    }

    const id = match[1]
    const style = inserted[id]
    if (style === true || style === undefined || seen[id]) {
      continue
    }
    seen[id] = true
    styles += style
    ids += ` ${id}`
  }

  result += html.substring(lastInsertionPoint)
  return result
}
