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

import { installAttributionGuard } from '@aglyn/aglyn/app-utils/attribution-guard'
import { useEffect } from 'react'

export interface AttributionGuardProps {
  hostId?: string
}

/**
 * Mounts the attribution guard (AGL-1477). Renders nothing.
 *
 * From an effect rather than module scope — the opposite of the error beacon
 * beside it, and for the opposite reason. That one exists to catch failures
 * during boot, so it has to be armed before boot. This one measures whether
 * elements are PRESENTED, which is a question with no answer until the
 * document has been laid out; asking it at module scope would ask it of a
 * page that does not exist yet.
 */
export default function AttributionGuard(props: AttributionGuardProps): null {
  const { hostId } = props
  useEffect(() => {
    installAttributionGuard({ hostId })
  }, [hostId])
  return null
}
