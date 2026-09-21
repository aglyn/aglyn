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
 * A SCREENSHOT OF A PREVIEW MUST NOT READ AS A PUBLISHED POST (AGL-3205).
 *
 * The preview renders the real page: the site's theme, the site's shared
 * layout, the entry's own template. That fidelity is the feature and it is
 * also the hazard — an image of it is indistinguishable from an image of the
 * live post, and images get forwarded.
 *
 * So the chrome is asserted for the two properties that actually make it
 * work: it SAYS the post is not published, in words rather than in a color,
 * and it stays on screen rather than scrolling away.
 */

import { render, screen } from '@testing-library/react'
import PreviewBanner, {
  PREVIEW_BANNER_ID,
  previewSentence,
} from '../app/[host]/[scheme]/aglyn-preview/preview-banner'

/** 22 Sep 2026, 14:00 UTC — one of the real scheduled posts' shape. */
const SCHEDULED_AT = Math.floor(Date.UTC(2026, 8, 22, 14, 0, 0) / 1000)

describe('the preview banner states what the page is', () => {
  it('leads with the negative, not with the date', () => {
    const sentence = previewSentence('scheduled', SCHEDULED_AT)
    expect(sentence.startsWith('This post is not published.')).toBe(true)
  })

  it('names the scheduled instant, and the clock it is quoting', () => {
    const sentence = previewSentence('scheduled', SCHEDULED_AT)
    expect(sentence).toContain('September 22, 2026')
    expect(sentence).toContain('UTC')
  })

  it('says so plainly for a draft with no date', () => {
    expect(previewSentence('draft', null)).toBe(
      'This post is not published. It is a draft, and nothing is scheduled.',
    )
  })

  it('does not invent a date for a schedule that has none', () => {
    const sentence = previewSentence('scheduled', null)
    expect(sentence).toContain('not published')
    expect(sentence).toContain('no date set')
    // 1970 is what a `?? 0` here would print, and it would look like a fact.
    expect(sentence).not.toContain('1970')
  })
})

describe('the preview banner cannot be scrolled past or styled away', () => {
  it('renders the word PREVIEW and the sentence together', () => {
    render(<PreviewBanner status="scheduled" publishAtSeconds={SCHEDULED_AT} />)
    expect(screen.getByText('PREVIEW')).toBeTruthy()
    expect(
      screen.getByText(/This post is not published/),
    ).toBeTruthy()
  })

  it('is fixed to the viewport above anything a site can author', () => {
    const { container } = render(
      <PreviewBanner status="scheduled" publishAtSeconds={SCHEDULED_AT} />,
    )
    const bar = container.querySelector(`#${PREVIEW_BANNER_ID}`) as HTMLElement
    // A premise guard: `getComputedStyle` on a missing element would throw,
    // but a query that found the wrong node would silently pass below.
    expect(bar).toBeTruthy()
    expect(bar.style.position).toBe('fixed')
    expect(Number(bar.style.zIndex)).toBeGreaterThan(1_000_000)
  })

  it('makes room for itself so it does not sit on top of the page', () => {
    const { container } = render(
      <PreviewBanner status="draft" publishAtSeconds={null} />,
    )
    // Two elements: the fixed bar, and a spacer in normal flow. Without the
    // spacer the site's own header renders underneath the bar.
    expect(container.children).toHaveLength(2)
    expect(container.children[1].getAttribute('aria-hidden')).toBe('true')
  })

  it('announces itself to a screen reader as a status, not as decoration', () => {
    render(<PreviewBanner status="draft" publishAtSeconds={null} />)
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
