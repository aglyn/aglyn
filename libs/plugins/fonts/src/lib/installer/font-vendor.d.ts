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

/*
 * Neither package ships declarations. These name only what the installer
 * calls (AGL-3656).
 */

declare module 'fontverter' {
  export type FontFormat = 'sfnt' | 'truetype' | 'woff' | 'woff2'
  export function detectFormat(buffer: Buffer): 'sfnt' | 'woff' | 'woff2'
  export function convert(buffer: Buffer, toFormat: FontFormat, fromFormat?: FontFormat): Promise<Buffer>
}

declare module 'subset-font' {
  interface SubsetFontOptions {
    targetFormat?: 'sfnt' | 'truetype' | 'woff' | 'woff2'
    preserveNameIds?: number[]
    keepFeatures?: string[]
    variationAxes?: Record<string, number | { min: number; max: number; default?: number }>
    noLayoutClosure?: boolean
    glyphNames?: boolean
    noHinting?: boolean
    dropTables?: string[]
    keepAllGlyphs?: boolean
  }
  function subsetFont(font: Buffer, text: string, options?: SubsetFontOptions): Promise<Buffer>
  export = subsetFont
}
