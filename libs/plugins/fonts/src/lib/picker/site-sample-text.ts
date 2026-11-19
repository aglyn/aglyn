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
 * The words a font preview is drawn in (AGL-3656), apart from the hook that
 * reads them, so the native apps' font pickers replay the same sample
 * (AGL-3668). No imports.
 */

/** The words a font preview is drawn in: the site's own, where it has them. */
export interface SiteSample {
  /** The site's name. */
  title: string
  /** A headline. */
  heading: string
  /** A sentence of running text. */
  paragraph: string
}

const FALLBACK: SiteSample = {
  title: 'Your site',
  heading: 'A headline that sets the tone',
  paragraph: 'Running text reads like this, sentence after sentence, on every page of your site.',
}

/** Trims a site's text to a preview's length, on a word. */
function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max).replace(/\s+\S*$/, '')}…`
}

/** The sample for a site document as it was read. */
export function siteSampleFrom(host: { displayName?: unknown; name?: unknown; seo?: { title?: unknown; description?: unknown } } | undefined): SiteSample {
  const named = [host?.displayName, host?.name].find((value) => typeof value === 'string' && value.trim())
  const name = typeof named === 'string' ? clip(named, 48) : ''
  const title = typeof host?.seo?.title === 'string' && host.seo.title.trim() ? clip(host.seo.title, 70) : ''
  const description =
    typeof host?.seo?.description === 'string' && host.seo.description.trim() ? clip(host.seo.description, 160) : ''
  return {
    title: name || title || FALLBACK.title,
    heading: title && title !== name ? title : name ? `Welcome to ${name}` : FALLBACK.heading,
    paragraph: description || FALLBACK.paragraph,
  }
}
