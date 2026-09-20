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

import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import type { SendingIdentityView } from '@aglyn/tenant-feature-instance/hooks/use-sending-identity-api'
import { Suspense, type ReactElement } from 'react'

/**
 * WHAT A CAMPAIGN EMAIL ASKS OF WHICHEVER PLUGIN KEEPS THE MAIL ITSELF.
 *
 * A campaign is this plugin's: who it goes to, when, under which container,
 * and what came of it. The mail it rides on is not. The catalog of streams a
 * recipient can leave, the identities a site may send as, the design document
 * a message is built from and the renderer that turns one into what an inbox
 * receives all belong to the plugin that keeps email, and a composer that
 * imported them would make this package uninstallable without that one.
 *
 * So each is a zone this plugin hosts. It hands over what it holds — the
 * site, the value, a callback — and draws whatever a widget there draws. A
 * widget never writes a campaign: it reports a choice through the callback
 * and the composer does the write, because the record is this plugin's.
 *
 * Outside a console shell, and in a workspace with no plugin filling a zone,
 * each of these draws nothing.
 */

/** The stream this email belongs to, chosen before it is sent. */
export interface CampaignTopicSelectZoneProps {
  hostId: string
  /** The chosen topic id; empty until the widget settles it on a real one. */
  value: string
  onChange: (topicId: string) => void
  disabled?: boolean
}

export const CAMPAIGN_TOPIC_SELECT_ZONE =
  definePluginZone<CampaignTopicSelectZoneProps>('campaignTopicSelect')

/** One stream a campaign can open on. */
export interface CampaignTopicOption {
  id: string
  name: string
}

/**
 * The streams a campaign can open on, REPORTED rather than drawn.
 *
 * The two drawers that collect a campaign's topic are generic forms whose
 * select takes a list of options, so what they need from the catalog's owner
 * is the list. A widget here draws nothing: it reads the catalog while
 * `enabled` and answers through `onTopics`. `enabled` is the read gate —
 * the catalog is the section's largest read and only an open drawer needs it.
 */
export interface CampaignTopicOptionsZoneProps {
  hostId: string
  enabled: boolean
  onTopics: (topics: readonly CampaignTopicOption[]) => void
}

export const CAMPAIGN_TOPIC_OPTIONS_ZONE =
  definePluginZone<CampaignTopicOptionsZoneProps>('campaignTopicOptions')

/**
 * Adding a sender without leaving the email being written. The widget is the
 * editor, opened in its ADD mode; `onSaved` names the sender it created so
 * the composer can select it once its own read shows the row.
 */
export interface CampaignSenderEditorZoneProps {
  hostId: string
  view: SendingIdentityView | null
  onClose: () => void
  onSaved: (senderId?: string) => void
}

export const CAMPAIGN_SENDER_EDITOR_ZONE =
  definePluginZone<CampaignSenderEditorZoneProps>('campaignSenderEditor')

/**
 * A design document of this email's own. The widget is the control that mints
 * one; `onCreated` names it, and the composer records the choice on the
 * campaign and opens the editor.
 */
export interface CampaignDesignCreateZoneProps {
  hostId: string
  /** What to call the design, so the picker does not list "Untitled email". */
  name?: string
  onCreated: (design: { screenId: string; versionId: string }) => void
  onError: (error: unknown) => void
}

export const CAMPAIGN_DESIGN_CREATE_ZONE =
  definePluginZone<CampaignDesignCreateZoneProps>('campaignDesignCreate')

/** The message as an inbox receives it, on the message's own page. */
export interface CampaignDesignPreviewZoneProps {
  hostId: string
  /** The version document's raw `nodes` field, in any of its stored forms. */
  nodes: unknown
  /** The plain-text body, for a message composed without a design. */
  text?: string
  loading?: boolean
  subject?: string
  preheader?: string
  emptyMessage: string
  note?: string
}

export const CAMPAIGN_DESIGN_PREVIEW_ZONE =
  definePluginZone<CampaignDesignPreviewZoneProps>('campaignDesignPreview')

/**
 * Draws one of the zones above where the shell provides a renderer.
 *
 * Under its own \`Suspense\`, with nothing as the fallback. A widget is a lazy
 * chunk, and several of these mount in answer to a click — the sender editor,
 * the topics behind an opening drawer. Without a boundary here the suspension
 * would climb to the page's, and the form being filled in would be swapped
 * for a loading state while one drawer's code arrives.
 */
function zoneHost<Props extends object>(zone: { id: string }, name: string) {
  function Host(props: Props): ReactElement | null {
    const Zone = useConsoleWidgetSlot()
    return Zone ? (
      <Suspense fallback={null}>
        <Zone slot={zone.id} {...props} />
      </Suspense>
    ) : null
  }
  Host.displayName = name
  return Host
}

export const CampaignTopicSelect = zoneHost<CampaignTopicSelectZoneProps>(
  CAMPAIGN_TOPIC_SELECT_ZONE,
  'CampaignTopicSelect',
)
export const CampaignTopicOptions = zoneHost<CampaignTopicOptionsZoneProps>(
  CAMPAIGN_TOPIC_OPTIONS_ZONE,
  'CampaignTopicOptions',
)
export const CampaignSenderEditor = zoneHost<CampaignSenderEditorZoneProps>(
  CAMPAIGN_SENDER_EDITOR_ZONE,
  'CampaignSenderEditor',
)
export const CampaignDesignCreate = zoneHost<CampaignDesignCreateZoneProps>(
  CAMPAIGN_DESIGN_CREATE_ZONE,
  'CampaignDesignCreate',
)
export const CampaignDesignPreview = zoneHost<CampaignDesignPreviewZoneProps>(
  CAMPAIGN_DESIGN_PREVIEW_ZONE,
  'CampaignDesignPreview',
)
