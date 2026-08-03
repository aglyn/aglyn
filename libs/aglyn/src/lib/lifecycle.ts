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

// Deep import, NOT the package root (AGL-1151): the root's `Timestamp` extends
// the Firestore SDK's, which is a hard runtime dependency, and these four calls
// only stamp a log line. Importing the class here put the whole Firestore
// client in every tenant site's eagerly-loaded page chunk.
import { timestampNowJson } from '@aglyn/shared-util-timestamp/timestamp-json'
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
    logger.debug(timestampNowJson(), beforeEvent, beforePayload)
    emitter.emit(beforeEvent, timestampNowJson(), ...beforePayload)
    callbackFn()
    logger.debug(timestampNowJson(), afterEvent, afterPayload)
    emitter.emit(afterEvent, timestampNowJson(), ...afterPayload)
  } catch (e) {
    emitter.emit(AglynEvent.ERROR_GENERAL, {
      message:
        (e as Error)?.message || `An error has occurred before event ${beforeEvent}`,
    })
    onCatch && onCatch(e)
  }
}
