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

import { pdfString } from './pdf-text'

/*==========================================
 * A PDF FILE FROM PAGES OF DRAWING OPERATORS, with no PDF library.
 *
 * Object numbers are fixed, so a document is the same bytes every time it is
 * made from the same input:
 *
 *   1 catalog · 2 page tree · 3 Helvetica (`/F1`) · 4 Helvetica-Bold (`/F2`)
 *   · 5 Helvetica-Oblique (`/F3`) · 6 document info · then each page and its
 *   content stream · then each JPEG image · then each link annotation.
 *
 * Fonts are the standard ones in WinAnsi (nothing embedded); images are JPEG
 * passed through as DCTDecode streams (no decoding here); links are URI
 * annotations. The cross-reference table is written from the byte offsets of
 * the objects as they are laid down.
 *
 * Reached as `@aglyn/shared-util-tools/pdf/pdf-file`.
 *=========================================*/

/** A JPEG ready to draw: its bytes untouched, with what the image dictionary needs. */
export interface PdfJpegImage {
  bytes: Uint8Array
  width: number
  height: number
  /** 1 gray, 3 RGB, 4 CMYK. */
  components: 1 | 3 | 4
  /** An Adobe CMYK JPEG stores its ink inverted. */
  invertedCmyk?: boolean
}

/** A clickable area on a page, in points from the bottom-left corner, opening `url`. */
export interface PdfLinkArea {
  x: number
  y: number
  width: number
  height: number
  url: string
}

export interface PdfFilePage {
  width: number
  height: number
  /** The page's content stream: drawing operators in printable ASCII. */
  content: string
  links?: readonly PdfLinkArea[]
}

export interface PdfFileInput {
  pages: readonly PdfFilePage[]
  /** Images every page may draw as `/Im1`, `/Im2`, … in this order. */
  images?: readonly PdfJpegImage[]
  title: string
  /** The making software, in the document's properties; left out when not given. */
  producer?: string
}

/** A number as a PDF operand: two decimals at most, no trailing zeros. */
export function pdfNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return (Object.is(rounded, -0) ? 0 : rounded).toString()
}

/**
 * A link target as a PDF string literal's body. Only web and mail addresses
 * are linked; a URI is 7-bit ASCII in a PDF, so anything else is
 * percent-encoded. Null for an address that is not one of those.
 */
export function pdfUri(url: string): string | null {
  const value = String(url ?? '').trim()
  if (!/^(https?:\/\/|mailto:)/i.test(value) || value.length > 2000) return null
  let ascii = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    ascii += code > 0x20 && code < 0x7f ? char : encodeURIComponent(char)
  }
  return ascii.replace(/[\\()]/g, (match) => `\\${match}`)
}

/**
 * The size and color layout of a JPEG from its frame header, or null when the
 * bytes are not a JPEG this can place (no start-of-image, no frame, or a frame
 * with an unusual channel count).
 */
export function readJpeg(bytes: Uint8Array): PdfJpegImage | null {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  let adobe = false
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    // Markers that stand alone: restart, start and end of image, TEM.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      offset += 2
      continue
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2 || offset + 2 + length > bytes.length) return null
    if (marker === 0xee) adobe = true
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (frame) {
      const start = offset + 4
      if (length < 8 || bytes[start] !== 8) return null
      const height = (bytes[start + 1] << 8) | bytes[start + 2]
      const width = (bytes[start + 3] << 8) | bytes[start + 4]
      const components = bytes[start + 5]
      if (!width || !height || (components !== 1 && components !== 3 && components !== 4)) return null
      return { bytes, width, height, components, ...(components === 4 && adobe ? { invertedCmyk: true } : {}) }
    }
    if (marker === 0xda) return null
    offset += 2 + length
  }
  return null
}

function imageDictionary(image: PdfJpegImage): string {
  const space = image.components === 1 ? '/DeviceGray' : image.components === 4 ? '/DeviceCMYK' : '/DeviceRGB'
  const decode = image.components === 4 && image.invertedCmyk ? ' /Decode [1 0 1 0 1 0 1 0]' : ''
  return (
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
    `/ColorSpace ${space} /BitsPerComponent 8${decode} /Filter /DCTDecode /Length ${image.bytes.length} >>`
  )
}

/** The bytes of a PDF file holding `input.pages`. */
export function buildPdfFile(input: PdfFileInput): Uint8Array {
  const pages = input.pages
  const images = input.images ?? []
  // Each object is text, or text around binary stream data.
  const objects: Array<string | [string, Uint8Array, string]> = []
  const pageIds = pages.map((_, index) => 7 + index * 2)
  const firstImageId = 7 + pages.length * 2
  const imageIds = images.map((_, index) => firstImageId + index)
  let nextId = firstImageId + images.length

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'
  objects[6] =
    input.producer === undefined
      ? `<< /Title (${pdfString(input.title)}) >>`
      : `<< /Title (${pdfString(input.title)}) /Producer (${pdfString(input.producer)}) >>`

  const xObjects = imageIds.length
    ? ` /XObject << ${imageIds.map((id, index) => `/Im${index + 1} ${id} 0 R`).join(' ')} >>`
    : ''
  pages.forEach((page, index) => {
    const pageId = pageIds[index]
    const annotIds: number[] = []
    for (const link of page.links ?? []) {
      const uri = pdfUri(link.url)
      if (!uri) continue
      const id = nextId++
      annotIds.push(id)
      const rect = [link.x, link.y, link.x + link.width, link.y + link.height].map(pdfNumber).join(' ')
      objects[id] =
        `<< /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0] ` +
        `/A << /Type /Action /S /URI /URI (${uri}) >> >>`
    }
    const annots = annotIds.length ? ` /Annots [${annotIds.map((id) => `${id} 0 R`).join(' ')}]` : ''
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(page.width)} ${pdfNumber(page.height)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${xObjects} >>${annots} /Contents ${pageId + 1} 0 R >>`
    objects[pageId + 1] = `<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`
  })
  images.forEach((image, index) => {
    objects[imageIds[index]] = [`${imageDictionary(image)}\nstream\n`, image.bytes, '\nendstream']
  })

  // Text is one byte per character (every string above is ASCII or Latin-1),
  // so its length is its byte count.
  const chunks: Uint8Array[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? latin1(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  push('%PDF-1.4\n%âãÏÓ\n')
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = length
    const object = objects[id]
    push(`${id} 0 obj\n`)
    if (typeof object === 'string') push(object)
    else object.forEach(push)
    push('\nendobj\n')
  }
  const xref = length
  let tail = `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) tail += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  tail += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  push(tail)

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff
  return bytes
}
