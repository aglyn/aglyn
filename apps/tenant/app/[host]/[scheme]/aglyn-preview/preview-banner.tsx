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

import type { CSSProperties } from 'react'

/** The id the spec reaches for, and the one an author could style around. */
export const PREVIEW_BANNER_ID = 'aglyn-entry-preview-banner'

/** Its height, spent twice: on the bar and on the spacer that makes room. */
const BAR_HEIGHT_PX = 44

/**
 * Says the one thing a screenshot of this page must also say (AGL-3205).
 *
 * A live-site preview is a faithful render at the real address: the site's
 * theme, the site's shared layout, the entry's own template screen. That is
 * the point of it, and it is also the whole hazard — a screenshot of an
 * unpublished post is indistinguishable from a screenshot of a published one,
 * and gets forwarded as though the post were out.
 *
 * So the chrome is loud, fixed, and part of the document rather than an
 * overlay something can scroll past: `position: fixed` keeps it in every
 * screenshot of the viewport, and the spacer beneath it moves the page down by
 * exactly its own height so a site header in normal flow is not covered.
 *
 * INLINE STYLES, deliberately. The tenant sends no `style-src` (see the
 * middleware's note on why it cannot), but that is not the reason — the reason
 * is that this bar must render identically on every customer site, including
 * one whose theme has opinions about every element on the page, and a class
 * name is something a site's own CSS can reach.
 *
 * A Server Component with no interactivity: nothing here hydrates, so a
 * preview whose site plugins fail to load still carries its warning.
 */
export function PreviewBanner({
  status,
  publishAtSeconds,
}: {
  /** The entry's stored status — `scheduled` or `draft`. */
  status: string
  /** When it is due, or null when nothing is scheduled. */
  publishAtSeconds: number | null
}) {
  const bar: CSSProperties = {
    position: 'fixed',
    insetBlockStart: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    // Above anything a site can author. The canvas caps its own stacking well
    // below this, and a preview warning that a sticky nav can cover is a
    // preview warning that is not there.
    zIndex: 2147483647,
    minBlockSize: `${BAR_HEIGHT_PX}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap',
    padding: '0.5rem 1rem',
    // Not a theme color: a preview bar that inherited the site's palette could
    // be styled into invisibility by the very site it is warning about.
    background: '#111827',
    color: '#fde68a',
    borderBlockEnd: '3px solid #f59e0b',
    font: '600 14px/1.3 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    textAlign: 'center',
    boxSizing: 'border-box',
  }
  return (
    <>
      <div
        id={PREVIEW_BANNER_ID}
        role="status"
        aria-live="polite"
        data-aglyn-preview="1"
        style={bar}
      >
        <span
          style={{
            background: '#f59e0b',
            color: '#111827',
            borderRadius: '2px',
            padding: '0.1rem 0.4rem',
            letterSpacing: '0.08em',
          }}
        >
          {'PREVIEW'}
        </span>
        <span>{previewSentence(status, publishAtSeconds)}</span>
      </div>
      {/* Normal flow, so a site header that is not itself fixed starts below
          the bar rather than under it. */}
      <div
        aria-hidden="true"
        style={{ blockSize: `${BAR_HEIGHT_PX}px`, flex: '0 0 auto' }}
      />
    </>
  )
}

/**
 * What the bar says, in one sentence.
 *
 * States the negative FIRST — "not published" — because that is the fact a
 * reader has to leave with, and a sentence that opens with a date reads like
 * an announcement of a post that is out.
 *
 * The instant is printed in UTC and labelled UTC. This renders on a server
 * that has no idea where the reader is, and a time silently rendered in the
 * wrong zone on a page about WHEN something goes live is worse than one that
 * is explicit about which clock it is quoting.
 */
export function previewSentence(
  status: string,
  publishAtSeconds: number | null,
): string {
  if (status === 'scheduled' && publishAtSeconds) {
    return `This post is not published. It is scheduled for ${formatUtc(publishAtSeconds)}.`
  }
  if (status === 'scheduled') {
    return 'This post is not published. It is scheduled, with no date set.'
  }
  return 'This post is not published. It is a draft, and nothing is scheduled.'
}

function formatUtc(seconds: number): string {
  return `${new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(seconds * 1000))} UTC`
}

export default PreviewBanner
