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

import { type CSSProperties, useCallback } from 'react'

/**
 * The frame a hosted player plays in, once a visitor has pressed play
 * (AGL-2826).
 *
 * Shared by the Video element, which puts it where the poster was, and by the
 * lightbox, which opens it in a dialog, so the two cannot disagree about what
 * the frame may do. Nothing renders this before a press: the element's poster
 * is a button until then, which is what keeps the player's origin off the wire
 * for a visitor who only looks at the page.
 */
export interface VideoPlayerFrameProps {
  /** The player's address, rebuilt by the caller from a parsed media id. */
  src: string
  /** Names the frame for assistive technology. */
  title?: string
  /** `width / height`; 16:9 when nothing measured the film. */
  aspectRatio?: string
  /** A CSS height the author pinned, which replaces the ratio. */
  height?: string
  /** Corner radius in px, matching the poster it replaced. */
  radius?: number
  /**
   * Move focus into the player as it mounts. For the in-place player only,
   * where the button that was pressed has just left the page and focus would
   * otherwise fall back to the body.
   *
   * ⛔ Never inside the lightbox. A cross-origin frame keeps every key pressed
   * while it has focus, so `Escape` never reaches the dialog. Measured on
   * 2026-09-10: with focus moved into the Wistia frame, `Escape` left the
   * dialog open and the film playing. Left on the dialog, `Escape` closes it,
   * and `Tab` still reaches the player.
   */
  focusOnMount?: boolean
  /** Layout the placement adds, such as the lightbox's flex, applied last. */
  style?: CSSProperties
}

/** What the frame is called when the author gave the video no title. */
const FALLBACK_TITLE = 'Video player'

/** The shape assumed for a film nobody measured. */
const DEFAULT_ASPECT_RATIO = '16 / 9'

export function VideoPlayerFrame(props: VideoPlayerFrameProps) {
  const { src, title, aspectRatio, height, radius, focusOnMount, style } = props
  const takeFocus = useCallback((node: HTMLIFrameElement | null) => {
    node?.focus()
  }, [])
  return (
    <iframe
      ref={focusOnMount ? takeFocus : undefined}
      src={src}
      title={title || FALLBACK_TITLE}
      // `autoplay` is delegated because the press happened in this document
      // and the film plays in another one: without the grant a browser may
      // refuse to start the film the visitor just asked for.
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      // The Video embed block's sandbox: the player runs its own scripts on
      // its own origin and may open a link in a new tab, and it may not
      // navigate this page or submit a form from it.
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      style={{
        display: 'block',
        width: '100%',
        height: height || undefined,
        aspectRatio: height ? undefined : aspectRatio || DEFAULT_ASPECT_RATIO,
        border: 0,
        borderRadius: radius != null ? `${radius}px` : undefined,
        ...style,
      }}
    />
  )
}
VideoPlayerFrame.displayName = 'VideoPlayerFrame'
