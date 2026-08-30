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

import { activeEmailTopics, DEFAULT_CAMPAIGN_TOPIC_ID } from '@aglyn/aglyn'
import { MenuItem, TextField } from '@mui/material'
import { useEffect } from 'react'
import { useOrgEmailTopics } from './use-org-email-topics'

export interface CampaignTopicSelectProps {
  hostId: string
  /** The chosen topic id; empty until the effect below settles it. */
  value: string
  onChange: (topicId: string) => void
  disabled?: boolean
}

/**
 * WHICH STREAM this campaign belongs to, chosen before it is sent.
 *
 * The topic decides three things at once: which recipients the send skips
 * (anyone who has left this stream), what the preference page linked from the
 * footer highlights as "this email", and which stream a resulting unsubscribe
 * is recorded against. So it is a composer field rather than a setting — it is
 * a property of the message, and the same site sends promotions and a
 * newsletter in the same week.
 *
 * ## Why this is its own component
 *
 * The composer (`campaigns-card.tsx`) is a large component under concurrent
 * edit. Keeping the picker separate means it can be dropped into the
 * composer's field stack as one line and carries its own read of the org
 * catalog, rather than threading a fifth collection listener through a
 * component that already holds four.
 *
 * Retired topics are not offered. A campaign may not be composed under a
 * stream nobody can unsubscribe from — but a campaign already SENT under one
 * keeps resolving, which is why retiring is not deleting. See
 * `email-topics-card.tsx`.
 */
export function CampaignTopicSelect(props: CampaignTopicSelectProps) {
  const { hostId, value, onChange, disabled } = props
  const { topics } = useOrgEmailTopics(hostId)
  const options = activeEmailTopics(topics)

  /*
   * SETTLE ON A REAL OPTION, rather than submitting an empty topic.
   *
   * The send resolves an absent topic to the default anyway, so an empty value
   * would still produce a correct send — but it would produce one whose topic
   * the composer never showed the author. A merchant is entitled to see which
   * stream they are about to mail before they press send, and a select that
   * reads blank while the server has already decided is the shape of a field
   * that lies.
   *
   * It also re-settles when the chosen topic leaves the list, which is what a
   * topic retired in another tab looks like from here.
   */
  useEffect(() => {
    if (!options.length) return
    if (options.some((topic) => topic.id === value)) return
    const fallback =
      options.find((topic) => topic.id === DEFAULT_CAMPAIGN_TOPIC_ID) ??
      options[0]
    onChange(fallback.id)
  }, [options, value, onChange])

  return (
    <TextField
      select
      size="small"
      label="Topic"
      value={options.some((topic) => topic.id === value) ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || !options.length}
      helperText={
        'Recipients who have left this stream are skipped, and the ' +
        'unsubscribe link in this email offers to stop it on its own.'
      }
    >
      {options.map((topic) => (
        <MenuItem key={topic.id} value={topic.id}>
          {topic.name}
        </MenuItem>
      ))}
    </TextField>
  )
}

export default CampaignTopicSelect
