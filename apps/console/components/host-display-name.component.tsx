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

import { useHost } from '../hooks/use-host'

export interface HostDisplayNameComponentProps {
  hostId: string
}

/**
 * Renders a host's displayName, falling back to the raw id while the doc
 * loads (or when no name is set). Used by console breadcrumbs so users see
 * "My Site" instead of the opaque host id (AGL-65).
 */
export function HostDisplayNameComponent(
  props: HostDisplayNameComponentProps,
) {
  const { hostId } = props
  const {
    doc: { data },
  } = useHost({ hostId })
  return <>{data?.displayName ?? hostId}</>
}
HostDisplayNameComponent.displayName = 'HostDisplayNameComponent'

export default HostDisplayNameComponent
