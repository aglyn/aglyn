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

import { activeEmailTopics } from '@aglyn/aglyn'
import { useEffect, useMemo } from 'react'
import { useOrgEmailTopics } from './use-org-email-topics'

/** What the campaign owner's topic-options zone hands a widget. */
export interface CampaignTopicOptionsWidgetProps {
  hostId: string
  enabled: boolean
  onTopics: (topics: ReadonlyArray<{ id: string; name: string }>) => void
}

/**
 * The streams a campaign can open on, reported to a drawer that lists them.
 *
 * Draws nothing. The catalog is read only while `enabled` — it is 200
 * documents filling one select inside a drawer that is usually shut — and
 * retired topics are left out, for the reason the composer's picker leaves
 * them out: a campaign may not be aimed at a stream nobody can leave.
 */
export function CampaignTopicOptionsWidget(
  props: CampaignTopicOptionsWidgetProps,
) {
  const { hostId, enabled, onTopics } = props
  const { topics } = useOrgEmailTopics(hostId, { enabled })
  const options = useMemo(
    () => activeEmailTopics(topics).map(({ id, name }) => ({ id, name })),
    [topics],
  )
  useEffect(() => {
    onTopics(options)
  }, [options, onTopics])
  return null
}

export default CampaignTopicOptionsWidget
