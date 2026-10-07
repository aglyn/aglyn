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
 * Star command bytes for a {@link PrintDocument} (AGL-3619), served to a
 * CloudPRNT printer as `application/vnd.star.starprntcore`: the subset of
 * StarPRNT that both Star Line Mode and StarPRNT emulation execute, so one
 * job prints on an mC-Print3, a TSP143IV and a legacy TSP650II alike.
 *
 * Every command used here is in that common subset:
 *
 * | bytes                 | command                                   |
 * | --------------------- | ----------------------------------------- |
 * | `1B 40`               | initialize                                |
 * | `1B 1D 61 n`          | alignment (0 left, 1 center, 2 right)     |
 * | `1B 45` / `1B 46`     | emphasis on / off                         |
 * | `1B 69 h w`           | character expansion (0 = normal, 1 = 2x)  |
 * | `1B 62 06 02 02 h d… 1E` | Code128, text below, 3-dot module, `h` dots tall |
 * | `1B 1C 70 n 00`       | print NV logo `n`                         |
 * | `07`                  | drive external device 1 (the cash drawer) |
 * | `1B 64 03`            | feed to the cutter and partial cut        |
 * | `0A`                  | line feed                                 |
 */
export const STAR_MEDIA_TYPE = 'application/vnd.star.starprntcore'

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** The drawer kick on its own, the bytes a "paid out" job sends: BEL drives drawer 1. */
export const STAR_DRAWER_KICK = [0x07] as const

const BARCODE_HEIGHT_DOTS = 80

function ascii(text: string): number[] {
  return Array.from(toPrintable(text), (char) => char.charCodeAt(0))
}

/** Star's NV logo number, 1-255; anything else prints no logo. */
export function starLogoNumber(logoKey: string | undefined): number | null {
  const value = Number(String(logoKey ?? '').trim())
  return Number.isInteger(value) && value >= 1 && value <= 255 ? value : null
}

export function renderStar(document: PrintDocument, options: { logoKey?: string } = {}): Uint8Array {
  const bytes: number[] = [ESC, 0x40]
  const logo = starLogoNumber(options.logoKey)
  let align = 0
  const setAlign = (next: number) => {
    if (next === align) return
    bytes.push(ESC, GS, 0x61, next)
    align = next
  }
  for (const op of document.ops) {
    switch (op.op) {
      case 'text': {
        setAlign(op.align === 'center' ? 1 : op.align === 'right' ? 2 : 0)
        const expand = op.size === 2 ? 1 : 0
        if (expand) bytes.push(ESC, 0x69, expand, expand)
        if (op.bold) bytes.push(ESC, 0x45)
        bytes.push(...ascii(op.text), LF)
        if (op.bold) bytes.push(ESC, 0x46)
        if (expand) bytes.push(ESC, 0x69, 0, 0)
        break
      }
      case 'feed':
        for (let index = 0; index < Math.max(0, Math.min(10, op.lines)); index += 1) bytes.push(LF)
        break
      case 'barcode':
        setAlign(1)
        bytes.push(ESC, 0x62, 0x06, 0x02, 0x02, BARCODE_HEIGHT_DOTS, ...ascii(op.data), 0x1e, LF)
        break
      case 'logo':
        if (logo !== null) {
          setAlign(1)
          bytes.push(ESC, 0x1c, 0x70, logo, 0x00)
        }
        break
      case 'drawer':
        bytes.push(...STAR_DRAWER_KICK)
        break
      case 'cut':
        bytes.push(ESC, 0x64, 0x03)
        break
    }
  }
  return Uint8Array.from(bytes)
}
