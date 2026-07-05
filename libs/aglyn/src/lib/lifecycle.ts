/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { Timestamp } from '@aglyn/shared-util-timestamp'
import { emitter, logger } from './aglyn'
import { AglynEvent } from './emit-manager'

export function lifecycleEvent(
  callbackFn: () => void,
  options: {
    beforeEvent: AglynEvent
    beforePayload: any[]
    afterEvent: AglynEvent
    afterPayload: any[]
    onCatch?: (e: unknown) => void
  },
): void {
  const { beforeEvent, beforePayload, afterEvent, afterPayload, onCatch } =
    options
  try {
    logger.debug(Timestamp.now().toJSON(), beforeEvent, beforePayload)
    emitter.emit(beforeEvent, Timestamp.now().toJSON(), ...beforePayload)
    callbackFn()
    logger.debug(Timestamp.now().toJSON(), afterEvent, afterPayload)
    emitter.emit(afterEvent, Timestamp.now().toJSON(), ...afterPayload)
  } catch (e) {
    emitter.emit(AglynEvent.ERROR_GENERAL, {
      message:
        (e as Error)?.message || `An error has occurred before event ${beforeEvent}`,
    })
    onCatch && onCatch(e)
  }
}
