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

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { Stack } from '@mui/material'
import { useRouter } from 'next/navigation'
import { HandOverScreen } from './hand-over-screen.component'
import { SignaturesCard } from './signatures-card.component'
import { useSiteWaivers } from './use-site-waivers'
import { WaiverEditor } from './waiver-editor.component'
import { WaiversListCard } from './waivers-list-card.component'

/**
 * The Waivers page (AGL-4042), at `/{site}/waivers`:
 * - the signatures, searched and exported, with a paper waiver recorded from
 *   here, and the site's waivers beneath;
 * - `/waivers/templates/{id}` (or `new`): writing one;
 * - `/waivers/sign/{id}`: the tablet handed over at the window.
 */
export function WaiversConsolePage(props: ConsolePluginPageProps) {
  const hostId = props.hostId ?? ''
  const router = useRouter()
  const permissions = props.permissions ?? {}
  const canManage = permissions['manageWaivers'] === true
  const canCollect = permissions['collectWaivers'] === true || canManage
  const { waivers, error, reload } = useSiteWaivers(hostId)
  const base = props.basePath ?? ''
  const [first, second] = props.segments ?? []
  const go = (path: string) => router.push(`${base}${path}`)

  if (!hostId) return null
  if (first === 'sign' && second) {
    return <HandOverScreen hostId={hostId} waiverId={second} canCollect={canCollect} onExit={() => go('')} />
  }
  if (first === 'templates' && second) {
    return (
      <WaiverEditor
        key={second}
        hostId={hostId}
        waiverId={second === 'new' ? null : second}
        canManage={canManage}
        onSaved={(waiver) => {
          reload()
          if (second === 'new') go(`/templates/${waiver.id}`)
        }}
        onBack={() => go('')}
      />
    )
  }
  return (
    <Stack spacing={3}>
      <SignaturesCard hostId={hostId} waivers={waivers ?? []} canManage={canManage} canCollect={canCollect} />
      <WaiversListCard
        hostId={hostId}
        waivers={waivers}
        error={error}
        canManage={canManage}
        canCollect={canCollect}
        onOpen={(waiverId) => go(`/templates/${waiverId}`)}
        onSignAtWindow={(waiverId) => go(`/sign/${waiverId}`)}
      />
    </Stack>
  )
}

export default WaiversConsolePage
