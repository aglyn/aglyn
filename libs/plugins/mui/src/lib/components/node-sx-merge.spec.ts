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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * A canvas node's authored styles reach a plugin component as the ARRAY
 * `mergeSxProps` builds in `leaf.tsx` — `[callerSx, props.sx, node.sx]`.
 * Never as a plain object.
 *
 * So `sx={{ ...ownDefaults, ...(rest.sx as object) }}` does not merge: it
 * spreads an array, yielding `{0: …, 1: …, 2: …}`. Emotion emits those
 * numeric keys as invalid selectors, so every authored property is dropped
 * while the block's own defaults still apply — the element looks
 * deliberately styled and nothing in the authoring loop reports a loss.
 * The Styles panel keeps reading the value back off the node, so an author
 * can only discover it by measuring the live DOM.
 *
 * This cost three separate fixes to the same mistake — AGL-1284 (Tabs, tab
 * panels, plugin iframes) and AGL-1450 (Entry Meta, Share Bar, category
 * pills, the product-grid skeleton) — so it is a guard now rather than a
 * fourth round of the same bug. The correct shape is an ARRAY with the
 * block's defaults first and the node's slice after it:
 *
 *   sx={[{ ...ownDefaults }, ...nodeSx]}
 *
 * where `nodeSx` is `Array.isArray(props.sx) ? props.sx : [props.sx]`.
 */
const PLUGINS_ROOT = resolve(__dirname, '../../../..')

/**
 * `...(rest.sx as object)` and every near-miss spelling of it. Deliberately
 * NOT anchored on a preceding `{` — the spread that caused AGL-1450 sat
 * mid-object, after a comma. The legitimate array recompositions read
 * `...(Array.isArray(rest.sx) ? …)` or `...nodeSx` and match neither branch.
 */
const OBJECT_SPREAD_OF_SX =
  /\.\.\.\(?\s*(?:rest|props)\s*(?:\.sx\b|\[['"]sx['"]\])/

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      return entry === 'node_modules' ? [] : walk(full)
    }
    return /\.tsx?$/.test(full) && !/\.spec\./.test(full) ? [full] : []
  })

describe('Node style slices survive a block that renders its own container (AGL-1450)', () => {
  it('no plugin component object-spreads the renderer-merged sx array', () => {
    const offenders: string[] = []
    for (const file of walk(PLUGINS_ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (OBJECT_SPREAD_OF_SX.test(line)) {
          offenders.push(
            `${relative(PLUGINS_ROOT, file)}:${index + 1} — ${line.trim()}`,
          )
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
