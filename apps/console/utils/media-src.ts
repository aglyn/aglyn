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
 * A usable `src` for a picked media asset.
 *
 * Lifted out of the listing detail editor when the publish form gained a
 * media picker of its own (AGL-1080). The CDN path is same-origin and
 * relative, so it needs the origin prefixed before it can be written into
 * markdown that renders elsewhere — a second hand-rolled copy would have
 * gotten that subtly wrong and produced images that work in the console and
 * break on the listing page.
 */
export function mediaSrc(media: {
  url?: string
  cdnPath?: string
}): string {
  // `cdnPath` FIRST (AGL-1215). It is keyed by media id, so it survives a
  // folder move — which physically copies the object, rewrites `url` and
  // deletes the original, permanently breaking anything holding the old
  // raw URL. Preferring `url` meant this helper emitted the fragile form
  // for every paid org, where both fields are always populated. `url`
  // stays the fallback for free-tier orgs (`cdnPath` is a paid `mediaCdn`
  // entitlement) and legacy uploads that predate it.
  if (media.cdnPath)
    return typeof window === 'undefined'
      ? media.cdnPath
      : `${window.location.origin}${media.cdnPath}`
  if (media.url) return media.url
  return ''
}

export default mediaSrc
