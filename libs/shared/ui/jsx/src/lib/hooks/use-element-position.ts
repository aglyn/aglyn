/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { type MutableRefObject, useLayoutEffect, useState } from 'react'

function getStyle(el, styleName) {
  return getComputedStyle(el)[styleName]
}

function getOffset(el) {
  if (!el) {
    return { top: 0, left: 0 }
  }
  console.log('el', el, el.ownerDocument, el)
  const rect = el.getBoundingClientRect?.()
  const doc = el.ownerDocument
  if (!doc) throw new Error('Unexpectedly missing <document>.')
  const win = doc.defaultView || doc['parentWindow']

  const winX =
    win.pageXOffset !== undefined
      ? win.pageXOffset
      : (doc.documentElement || doc.body.parentNode || doc.body)?.['scrollLeft']
  const winY =
    win.pageYOffset !== undefined
      ? win.pageYOffset
      : (doc.documentElement || doc.body.parentNode || doc.body)?.['scrollTop']

  return {
    top: rect.top + (isNaN(winX) ? 0 : winX),
    left: rect.left + (isNaN(winY) ? 0 : winY),
  }
}

function getPosition(el) {
  if (!el) {
    return { top: 0, left: 0 }
  }
  let offset = getOffset(el)
  let parentOffset = { top: 0, left: 0 }
  const marginTop = parseInt(getStyle(el, 'marginTop')) || 0
  const marginLeft = parseInt(getStyle(el, 'marginLeft')) || 0

  if (getStyle(el, 'position') === 'fixed') {
    offset = el.getBoundingClientRect()
  } else {
    const doc = el.ownerDocument

    let offsetParent: HTMLElement | ParentNode =
      el.offsetParent || doc.documentElement

    while (
      offsetParent &&
      (offsetParent === doc.body || offsetParent === doc.documentElement)
    ) {
      offsetParent = offsetParent.parentNode
    }

    if (offsetParent && offsetParent !== el && offsetParent.nodeType === 1) {
      parentOffset = getOffset(offsetParent as HTMLElement)
      parentOffset.top +=
        parseInt(getStyle(offsetParent, 'borderTopWidth')) || 0
      parentOffset.left +=
        parseInt(getStyle(offsetParent, 'borderLeftWidth')) || 0
    }
  }

  return {
    top: offset.top - parentOffset.top - marginTop,
    left: offset.left - parentOffset.left - marginLeft,
  }
}

export function useElementPosition(ref: MutableRefObject<any>) {
  const { top, left } = getPosition(ref?.current)
  const [ElementPosition, setElementPosition] = useState({
    top: top,
    left: left,
  })

  function handleChangePosition() {
    if (ref && ref.current) {
      setElementPosition(getPosition(ref.current))
    }
  }

  useLayoutEffect(() => {
    handleChangePosition()
    window.addEventListener('resize', handleChangePosition)

    return () => {
      window.removeEventListener('resize', handleChangePosition)
    }
  }, [])

  return ElementPosition
}

export default useElementPosition
