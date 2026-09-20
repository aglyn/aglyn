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

import type { SendingIdentityView } from '@aglyn/tenant-feature-instance/hooks/use-sending-identity-api'
import SendingSenderDrawer from './sending-sender-drawer'

/** What the campaign owner's sender-editor zone hands a widget. */
export interface CampaignSenderEditorWidgetProps {
  hostId: string
  view: SendingIdentityView | null
  onClose: () => void
  onSaved: (senderId?: string) => void
}

/**
 * The sender editor, opened from an email being written.
 *
 * `senderId={null}` is the ADD mode: the fields open empty, so the sender the
 * site already has is left exactly where it is rather than renamed by somebody
 * composing an email. The zone mounts this only once the author has asked for
 * it, so the drawer is simply open.
 */
export function CampaignSenderEditorWidget(
  props: CampaignSenderEditorWidgetProps,
) {
  const { hostId, view, onClose, onSaved } = props
  return (
    <SendingSenderDrawer
      open
      hostId={hostId}
      view={view}
      senderId={null}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

export default CampaignSenderEditorWidget
