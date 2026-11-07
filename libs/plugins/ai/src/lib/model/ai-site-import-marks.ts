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

/** Words in a picture's file name or alt text that make it a mark, not a photo (AGL-4152). */
const MARK_WORDS = /(?:^|[^a-z])(?:logos?|logotype|badges?|emblems?|favicon|wordmark|icons?)(?:[^a-z]|$)/i

/**
 * Whether a picture of the source is a brand's mark rather than a photo
 * (AGL-4152): its file name or its alt text calls it a logo, a badge, an
 * emblem, a wordmark or an icon. A mark is the source's words in a picture: a
 * cover, a photo band or any slot a redesign fills with a photo never takes
 * one, where a client's logo laid under a page's heading read as that page's
 * work. Its address is read by its last part, its words split where it runs
 * them together ("ClientLogo.jpg", "client+logo.png").
 */
export function aiSiteImportIsBrandMark(picture: { alt?: string | null; from?: string | null; url?: string | null }): boolean {
  const address = picture.from ?? picture.url ?? ''
  let file = address.split(/[?#]/)[0]?.split('/').pop() ?? ''
  try {
    file = decodeURIComponent(file.replace(/\+/g, ' '))
  } catch {
    file = file.replace(/\+/g, ' ')
  }
  const split = (text: string) => text.replace(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, ' ')
  return MARK_WORDS.test(split(file)) || MARK_WORDS.test(split(picture.alt ?? ''))
}
