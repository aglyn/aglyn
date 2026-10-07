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

import { toPrintable, type PrintDocument } from './print-document'

/**
 * A {@link PrintDocument} as plain text (AGL-3619): the `text/plain` fallback
 * a CloudPRNT printer may choose, and what a spec snapshots to read a layout
 * at a glance. Size and emphasis do not exist in plain text; alignment is
 * padding; a barcode prints its data between brackets; a drawer kick and a
 * cut print nothing.
 */
export function renderText(layout: PrintDocument): string {
  const { columns } = layout
  const lines: string[] = []
  for (const op of layout.ops) {
    switch (op.op) {
      case 'text': {
        const text = toPrintable(op.text).slice(0, columns)
        const gap = columns - text.length
        if (op.align === 'center') lines.push(`${' '.repeat(Math.floor(gap / 2))}${text}`.trimEnd())
        else if (op.align === 'right') lines.push(`${' '.repeat(gap)}${text}`)
        else lines.push(text)
        break
      }
      case 'feed':
        for (let index = 0; index < op.lines; index += 1) lines.push('')
        break
      case 'barcode': {
        const text = `[${toPrintable(op.data)}]`
        lines.push(`${' '.repeat(Math.max(0, Math.floor((columns - text.length) / 2)))}${text}`)
        break
      }
      default:
        break
    }
  }
  return `${lines.join('\n')}\n`
}
