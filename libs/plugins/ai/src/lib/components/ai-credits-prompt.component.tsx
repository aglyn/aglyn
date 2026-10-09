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

import { Alert, Button, Stack } from '@mui/material'
import {
  AI_CREDITS_BUILD_WHAT_FITS,
  aiCreditsPromptText,
  aiCreditsSmallerText,
  type AiCreditsPrompt,
} from '../model/ai-credit-estimate'
import { aiCreditsBillingHref } from './ai-job-links'

/**
 * What a Free job past what is left asks before it starts (AGL-3722), on the
 * Assist build plan card and in the guided start alike: the plain sentence —
 * about what it costs, what is left, that it builds what it can and pauses —
 * and its three ways on. Only "Build what fits" (or the smaller first build)
 * starts anything; nothing is started by showing this.
 */
export interface AiCreditsPromptProps {
  prompt: AiCreditsPrompt
  noun: 'build' | 'site'
  /** The workspace's path slug, for Upgrade; Upgrade is left out without it. */
  orgSlug?: string | null
  busy?: boolean
  /** "Build what fits": start it, to pause where the credits run out. */
  onBuildWhatFits: () => void
  /** The smaller first build; offered only when the prompt has one and this is given. */
  onSmaller?: () => void
}

export function AiCreditsPromptNotice({
  prompt,
  noun,
  orgSlug,
  busy = false,
  onBuildWhatFits,
  onSmaller,
}: AiCreditsPromptProps): JSX.Element {
  return (
    <Alert severity="warning" sx={{ mt: 1 }} role="alert" aria-label="More than your credits left">
      {aiCreditsPromptText(prompt, noun)}
      <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="contained" disabled={busy} onClick={onBuildWhatFits}>
          {AI_CREDITS_BUILD_WHAT_FITS}
        </Button>
        {prompt.smaller && onSmaller ? (
          <Button size="small" variant="outlined" disabled={busy} onClick={onSmaller}>
            {aiCreditsSmallerText(prompt.smaller)}
          </Button>
        ) : null}
        {orgSlug ? (
          <Button size="small" color="inherit" href={aiCreditsBillingHref(orgSlug)}>
            {'Upgrade'}
          </Button>
        ) : null}
      </Stack>
    </Alert>
  )
}

export default AiCreditsPromptNotice
