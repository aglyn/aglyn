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
'use client'

import { useEffect, useState } from 'react'
import {
  ELEMENT_PICK_MESSAGE_TYPE,
  type ElementPickMessage,
} from '@aglyn/aglyn/app-utils/element-pick-protocol'
import { elementPickTarget } from '@aglyn/aglyn/app-utils/element-pick-target'

/**
 * The origin of the page framing this one — the console. `ancestorOrigins`
 * where the browser has it, else the referrer the frame was opened with.
 * Framing is limited to Aglyn's own origins by `frame-ancestors`, and the
 * message carries only a selector the page already publishes, but it is
 * still addressed to its one reader rather than broadcast.
 */
function parentOrigin(fallback: string): string {
  const ancestors = window.location.ancestorOrigins
  if (ancestors && ancestors.length > 0) return ancestors[0]
  try {
    if (document.referrer) return new URL(document.referrer).origin
  } catch {
    // fall through
  }
  return fallback
}

interface Box {
  top: number
  left: number
  width: number
  height: number
  label: string
}

/**
 * Pick mode on a published page (AGL-3758): what the console's Actions card
 * opens in its picker frame. The element under the pointer is outlined and
 * named; a click is swallowed — no link followed, no form sent — and the
 * element's selector goes to the console. Escape cancels.
 *
 * Armed only by `?aglyn-pick` in a FRAME, so a visitor who opens such a link
 * directly sees the ordinary page.
 */
export default function ElementPickMode({ consoleOrigin }: { consoleOrigin: string }) {
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    const target = parentOrigin(consoleOrigin)
    const post = (message: ElementPickMessage) =>
      window.parent.postMessage(message, target)

    const onMove = (event: MouseEvent) => {
      const picked = elementPickTarget(event.target as Element | null)
      if (!picked) return setBox(null)
      const rect = picked.element.getBoundingClientRect()
      setBox({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        label: picked.label,
      })
    }
    const swallow = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onClick = (event: MouseEvent) => {
      swallow(event)
      const picked = elementPickTarget(event.target as Element | null)
      if (!picked) return
      post({
        type: ELEMENT_PICK_MESSAGE_TYPE,
        event: 'picked',
        selector: picked.selector,
        label: picked.label,
      })
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      post({ type: ELEMENT_PICK_MESSAGE_TYPE, event: 'cancel' })
    }
    const onScroll = () => setBox(null)

    // Capture phase, so the page's own handlers never see the pick's click.
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', swallow, true)
    document.addEventListener('submit', swallow, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    post({ type: ELEMENT_PICK_MESSAGE_TYPE, event: 'ready' })
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', swallow, true)
      document.removeEventListener('submit', swallow, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [consoleOrigin])

  // Plain inline styles in CSS SYSTEM colors: this draws over whatever the
  // site looks like and must read on all of it, which the site's own theme
  // cannot promise and the browser's selection colors do.
  return (
    <>
      <div
        role="status"
        style={{
          position: 'fixed',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2147483647,
          background: 'CanvasText',
          color: 'Canvas',
          font: '600 13px/1.4 system-ui, sans-serif',
          padding: '6px 12px',
          borderRadius: 6,
          pointerEvents: 'none',
          boxShadow: '0 2px 8px color-mix(in srgb, CanvasText 30%, transparent)',
        }}
      >
        {'Click the element to use · Esc to cancel'}
      </div>
      {box ? (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            zIndex: 2147483646,
            outline: '2px solid Highlight',
            background: 'color-mix(in srgb, Highlight 15%, transparent)',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: box.top > 24 ? -22 : '100%',
              left: 0,
              background: 'Highlight',
              color: 'HighlightText',
              font: '600 11px/1.6 system-ui, sans-serif',
              padding: '0 6px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
            }}
          >
            {box.label}
          </span>
        </div>
      ) : null}
    </>
  )
}
