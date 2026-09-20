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

import { useState, type ReactNode } from 'react'
import {
  CampaignTopicOptions,
  type CampaignTopicOption,
} from './campaign-email-zones'

/**
 * The streams a campaign can open on, for a drawer's topic field.
 *
 * The catalog is another plugin's, so it is not read here: `source` is the
 * zone a widget reports the list through, and it must be rendered for
 * `topics` to fill. It draws nothing. `enabled` reaches the widget as its
 * read gate, so a shut drawer costs no read.
 *
 * Empty where nothing fills the zone. A campaign may carry no topic — the send
 * resolves the default — so a drawer with no options is still a working one.
 */
export function useCampaignTopicOptions(
  hostId: string,
  options?: { enabled?: boolean },
): { topics: readonly CampaignTopicOption[]; source: ReactNode } {
  const [topics, setTopics] = useState<readonly CampaignTopicOption[]>([])
  return {
    topics,
    source: (
      <CampaignTopicOptions
        hostId={hostId}
        enabled={options?.enabled ?? true}
        onTopics={setTopics}
      />
    ),
  }
}

export default useCampaignTopicOptions
