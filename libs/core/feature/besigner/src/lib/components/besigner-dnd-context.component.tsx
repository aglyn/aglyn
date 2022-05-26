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

import type {BackendFactory} from 'dnd-core'
import {type ReactNode} from 'react'
import {DndProvider} from 'react-dnd'
// import {TouchBackend} from 'react-dnd-touch-backend'
import {HTML5Backend} from 'react-dnd-html5-backend'


export interface BesignerDndContextProps<BackendContext, BackendOptions> {
  children?: ReactNode
  backend?: BackendFactory
  context?: BackendContext
  options?: BackendOptions
  debugMode?: boolean
}

function BesignerDndContext<T, U>(props: BesignerDndContextProps<T, U>) {
  const {children, options, ...rest} = props
  const opts = {
    enableTouchEvents: true,
    enableMouseEvents: true,
    enableKeyboardEvents: true,
    delay: 0,
    delayTouchStart: 0,
    delayMouseStart: 0,
    touchSlop: 2,
    ...options,
  }

  return (
    <DndProvider
      backend={HTML5Backend}
      options={opts}
      {...rest}
      debugMode
    >
      {children}
    </DndProvider>
  )
}
BesignerDndContext.displayName = 'BesignerDndContext'
BesignerDndContext.aglyn = true

export {BesignerDndContext}
export default BesignerDndContext
