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

import { Box, Button, Stack, Typography } from '@mui/material'
import { useId } from 'react'
import {
  aiCreditsChoices,
  aiCreditsPromptText,
  type AiCreditsChoice,
  type AiCreditsPrompt,
} from '../model/ai-credit-estimate'
import { aiCreditsBillingHref } from './ai-job-links'

/**
 * What a Free job past what is left asks before it starts (AGL-3722), on the
 * Assist build plan card, in the guided start, on a build's page and in the
 * jobs drawer alike: the plain sentence — about what it costs, what is left,
 * that it builds what it can and pauses — and its ways on. Only "Build what
 * fits" (or the smaller first build) starts anything; nothing is started by
 * showing this.
 *
 * The ways on are one set of option buttons (Zach, 2026-10-10): the same
 * shape and height, full width so a long label never wraps beside another,
 * sentence case, a short label with its figure under it, and the recommended
 * one drawn as the primary button. Theme tokens only, so it reads the same in
 * the Assist panel's narrow column and in light or dark.
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

function AiCreditsChoiceButton({
  choice,
  busy,
  href,
  onClick,
}: {
  choice: AiCreditsChoice
  busy: boolean
  href?: string
  onClick?: () => void
}): JSX.Element {
  const detailId = `${useId()}-detail`
  return (
    <Button
      fullWidth
      size="medium"
      variant={choice.recommended ? 'contained' : 'outlined'}
      color="primary"
      disabled={busy && choice.key !== 'upgrade'}
      aria-label={choice.label}
      aria-describedby={detailId}
      data-choice={choice.key}
      {...(href ? { href } : { onClick })}
      sx={{
        minHeight: 56,
        px: 1.5,
        py: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        textAlign: 'left',
        textTransform: 'none',
        lineHeight: 1.3,
      }}
    >
      <Typography component="span" variant="body2" sx={{ fontWeight: 600, color: 'inherit' }}>
        {choice.label}
      </Typography>
      <Typography id={detailId} component="span" variant="caption" sx={{ color: 'inherit', opacity: 0.8 }}>
        {choice.detail}
      </Typography>
    </Button>
  )
}

export function AiCreditsPromptNotice({
  prompt,
  noun,
  orgSlug,
  busy = false,
  onBuildWhatFits,
  onSmaller,
}: AiCreditsPromptProps): JSX.Element {
  const choices = aiCreditsChoices(prompt, { smaller: Boolean(onSmaller), upgrade: Boolean(orgSlug) })
  return (
    <Box
      role="alert"
      aria-label="More than your credits left"
      sx={{
        mt: 1,
        p: 1.5,
        border: 1,
        borderColor: 'warning.main',
        borderRadius: 1,
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="body2" sx={{ color: 'text.primary' }}>
        {aiCreditsPromptText(prompt, noun)}
      </Typography>
      <Stack spacing={1} sx={{ mt: 1.5 }}>
        {choices.map((choice) => (
          <AiCreditsChoiceButton
            key={choice.key}
            choice={choice}
            busy={busy}
            {...(choice.key === 'upgrade' && orgSlug
              ? { href: aiCreditsBillingHref(orgSlug) }
              : { onClick: choice.key === 'smaller' ? onSmaller : onBuildWhatFits })}
          />
        ))}
      </Stack>
    </Box>
  )
}

export default AiCreditsPromptNotice
