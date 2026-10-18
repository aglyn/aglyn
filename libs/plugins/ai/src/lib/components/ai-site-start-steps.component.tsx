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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import {
  mdiBookOpenPageVariant,
  mdiBriefcaseOutline,
  mdiCalendarHeart,
  mdiCreation,
  mdiHandHeart,
  mdiScaleBalance,
  mdiShopping,
  mdiSilverwareForkKnife,
  mdiViewGridOutline,
  mdiWrench,
} from '@aglyn/shared-data-mdi'
import { HelpTip } from '@aglyn/shared-ui-jsx'
import { OptionCardGrid } from '@aglyn/shared-ui-jsx/components/option-card-grid.component'
import {
  Box,
  Button,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material'
import { Fragment, type ReactNode, type Ref } from 'react'
import { AI_SITE_FREE_PAGES_NOTE, AI_SITE_SUBMISSION_CHOICES, type AiSiteSubmissions } from '../model/ai-site-job'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import { AI_SITE_START_TYPES, aiSiteStartKind, type AiSiteStartAnswers } from '../model/ai-site-start'
import {
  AI_SITE_START_STEP_LABELS,
  AI_SITE_START_STEPS,
  aiSiteStartStepIndex,
  type AiSiteStartField,
  type AiSiteStartFieldError,
  type AiSiteStartStep,
} from '../model/ai-site-start-steps'
import type { AiSiteStartTracker } from './ai-site-start-tracking'
import { aiSiteStylePreview } from './ai-site-style-previews'

/**
 * The guided start's question steps (AGL-3898), one decision each. Each step
 * draws its own answers and writes them through `answer`, exactly the patch
 * the single form wrote, so the answers object is the same whichever way it
 * was filled in. The dialog around them (`ai-site-start-card.component.tsx`)
 * owns the step, Back and Next, validation and the job.
 */

/** Each part of the guided start links its own section of the Start with AI guide (AGL-3660). */
export const START_STEP_HELP = {
  kind: pluginDocsHelp('aiStart', {
    anchor: '#your-business',
    excerpt:
      'What kind of site it is picks its style and pages; who it is for is who every page and the contact form are written for.',
  }),
  audience: pluginDocsHelp('aiStart', {
    anchor: '#audience',
    excerpt: 'Who the site is for is who every page, every search listing and the contact form are written for. Optional.',
  }),
  review: pluginDocsHelp('aiStart', {
    anchor: '#review',
    excerpt: 'Every answer, each with Edit to change it. Plan my site creates the site, plans it, writes the pages and publishes it.',
  }),
  style: pluginDocsHelp('aiSiteLooks', {
    anchor: '#choose-a-style',
    excerpt:
      'The style decides the look — theme, colors, fonts, buttons — and which pages the site usually has. Every site gets its own variation.',
  }),
  details: pluginDocsHelp('aiStart', {
    anchor: '#details',
    excerpt:
      'Where contact form messages go, how many pages to write, and on paid plans whether to draft a welcome email. All can be changed later.',
  }),
}

/** The icon on each kind-of-site card: the icon of the style that answer picks. */
const START_TYPE_ICONS: Readonly<Record<string, string>> = {
  'a local service business': mdiBriefcaseOutline.path,
  'a restaurant or cafe': mdiSilverwareForkKnife.path,
  'a professional practice': mdiScaleBalance.path,
  'a trades business': mdiWrench.path,
  'a shop': mdiShopping.path,
  'a nonprofit': mdiHandHeart.path,
  'a personal portfolio': mdiViewGridOutline.path,
  'an event': mdiCalendarHeart.path,
}

/** "a restaurant or cafe" as a card title: "Restaurant or cafe". The answer itself keeps its words. */
export function startTypeTitle(type: string): string {
  const words = type.replace(/^(a|an)\s+/i, '')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The id the style grid gives "Pick for me", which is no kind: the answers' `kind: null`. */
export const AI_SITE_STYLE_AUTO = 'auto'

/** The progress through the steps: labeled steps on a wide screen, a bar and "Step 3 of 6" on a phone. */
export function StartProgress({ step, compact }: { step: AiSiteStartStep; compact: boolean }) {
  const index = aiSiteStartStepIndex(step)
  const count = AI_SITE_START_STEPS.length
  const name = `Step ${index + 1} of ${count}`
  if (compact) {
    return (
      <Stack spacing={1} data-start-area="progress" role="group" aria-label={name}>
        <Typography variant="caption" color="text.secondary">
          {`${name}: ${AI_SITE_START_STEP_LABELS[step]}`}
        </Typography>
        <LinearProgress variant="determinate" value={((index + 1) / count) * 100} aria-hidden />
      </Stack>
    )
  }
  return (
    <Stepper activeStep={index} alternativeLabel aria-label={name} data-start-area="progress">
      {AI_SITE_START_STEPS.map((id) => (
        <Step key={id}>
          <StepLabel>{AI_SITE_START_STEP_LABELS[id]}</StepLabel>
        </Step>
      ))}
    </Stepper>
  )
}

interface StepProps {
  answers: AiSiteStartAnswers
  answer: (patch: Partial<AiSiteStartAnswers>) => void
  tracker: AiSiteStartTracker
  /** Each field's reason not to go forward, once the person has tried to. */
  errors: Partial<Record<AiSiteStartField, AiSiteStartFieldError>>
  /** Where each field's input is, so a refused Next can put the cursor in it. */
  fieldRef: (field: AiSiteStartField) => Ref<HTMLInputElement>
}

/** A text answer's tracking: each change, and leaving the field, which ends one edit. */
const typed = (tracker: AiSiteStartTracker, field: AiSiteStartField) => ({
  onBlur: () => tracker.fieldLeft(field),
})

/** Step: what kind of site it is — the one required answer — typed, or picked from cards. */
export function KindStep({ answers, answer, tracker, errors, fieldRef }: StepProps) {
  const picked = AI_SITE_START_TYPES.includes(answers.siteType) ? answers.siteType : null
  return (
    <Stack spacing={3}>
      <Box data-start-area="field-siteType">
        <TextField
          fullWidth
          required
          inputRef={fieldRef('siteType')}
          label="What kind of site are you creating?"
          placeholder="a neighborhood dog groomer that takes bookings"
          value={answers.siteType}
          onChange={(event) => {
            answer({ siteType: event.target.value })
            tracker.fieldChanged('siteType')
          }}
          {...typed(tracker, 'siteType')}
          error={Boolean(errors.siteType)}
          helperText={errors.siteType?.message ?? 'A few words is enough, or pick one below.'}
        />
      </Box>
      <Stack spacing={1.5}>
        <Typography variant="overline" color="text.secondary" component="h2">
          {'Or pick the closest'}
        </Typography>
        <OptionCardGrid
          label="Kind of site"
          data-start-area="kind-cards"
          columns={{ xs: 2, sm: 2, md: 4 }}
          options={AI_SITE_START_TYPES.map((type) => ({
            id: type,
            title: startTypeTitle(type),
            icon: START_TYPE_ICONS[type] ?? mdiBookOpenPageVariant.path,
          }))}
          value={picked}
          onChange={(type) => {
            answer({ siteType: type })
            tracker.fieldPicked('siteType')
          }}
        />
      </Stack>
    </Stack>
  )
}

/** Step: who the site is for. Optional. */
export function AudienceStep({ answers, answer, tracker, errors, fieldRef }: StepProps) {
  return (
    <Box data-start-area="field-audience">
      <TextField
        fullWidth
        inputRef={fieldRef('audience')}
        label="Who is it for?"
        placeholder="local dog owners who want a regular groom booked online"
        value={answers.audience}
        onChange={(event) => {
          answer({ audience: event.target.value })
          tracker.fieldChanged('audience')
        }}
        {...typed(tracker, 'audience')}
        error={Boolean(errors.audience)}
        helperText={errors.audience?.message ?? 'Optional. It narrows who the pages are written for.'}
      />
    </Box>
  )
}

/**
 * Step: the style, from cards that show it. "Pick for me" leaves the kind
 * unset, which is what the single form's unpicked state was: the kind the
 * first answer suggests is the one used, and the card says which.
 */
export function StyleStep({ answers, answer, tracker }: StepProps) {
  const suggested = aiSiteStartKind({ ...answers, kind: null })
  return (
    <OptionCardGrid
      label="Style of site"
      data-start-area="style-cards"
      columns={{ xs: 2, sm: 2, md: 3 }}
      options={[
        {
          id: AI_SITE_STYLE_AUTO,
          title: 'Pick for me',
          description: `From your answer: ${suggested.label}`,
          icon: mdiCreation.path,
        },
        ...AI_SITE_KINDS.map((kind) => {
          const image = aiSiteStylePreview(kind.id)
          return { id: kind.id, title: kind.label, description: kind.blurb, ...(image ? { image } : {}) }
        }),
      ]}
      value={answers.kind ?? AI_SITE_STYLE_AUTO}
      onChange={(id) => {
        answer({ kind: id === AI_SITE_STYLE_AUTO ? null : id })
        tracker.fieldPicked('kind')
      }}
    />
  )
}

/** Step: where leads go, how many pages, and on a paid plan the welcome email. */
export function DetailsStep({
  answers,
  answer,
  tracker,
  errors,
  fieldRef,
  freeTaste,
  band,
}: StepProps & { freeTaste: boolean; band: { min: number; max: number } }) {
  return (
    <Stack spacing={3}>
      {/*
        The one setting a new site owner has to make, asked where they are
        already answering: a contact form nobody routed files its messages
        somewhere the person has not looked.
      */}
      <Box data-start-area="field-submissions">
        <TextField
          select
          fullWidth
          inputRef={fieldRef('submissions')}
          label="Where do form submissions go?"
          value={answers.submissions}
          onChange={(event) => {
            answer({ submissions: event.target.value as AiSiteSubmissions })
            tracker.fieldPicked('submissions')
          }}
          error={Boolean(errors.submissions)}
          helperText={errors.submissions?.message ?? 'You can change this on the form itself afterwards.'}
        >
          {AI_SITE_SUBMISSION_CHOICES.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {`${option.label} — ${option.blurb}`}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Box data-start-area="field-pages" sx={{ flex: 1 }}>
          <TextField
            select
            fullWidth
            inputRef={fieldRef('pages')}
            label="Pages"
            value={answers.pages}
            onChange={(event) => {
              answer({ pages: Number(event.target.value) })
              tracker.fieldPicked('pages')
            }}
            error={Boolean(errors.pages)}
            helperText={errors.pages?.message ?? (freeTaste ? AI_SITE_FREE_PAGES_NOTE : undefined)}
          >
            {Array.from({ length: band.max - band.min + 1 }, (_, index) => band.min + index).map((count) => (
              <MenuItem key={count} value={count}>
                {count}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        {!freeTaste && (
          <Box data-start-area="field-welcomeEmail" sx={{ flex: 1 }}>
            <TextField
              select
              fullWidth
              label="Welcome email"
              value={answers.welcomeEmail ? 'yes' : 'no'}
              onChange={(event) => {
                answer({ welcomeEmail: event.target.value === 'yes' })
                tracker.fieldPicked('welcomeEmail')
              }}
            >
              <MenuItem value="yes">{'Draft one'}</MenuItem>
              <MenuItem value="no">{'No'}</MenuItem>
            </TextField>
          </Box>
        )}
      </Stack>
    </Stack>
  )
}

/** One answer on the review, with the way back to the step that asks it. */
function ReviewRow({ label, value, step, onEdit }: { label: string; value: ReactNode; step: AiSiteStartStep; onEdit: (step: AiSiteStartStep) => void }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', py: 1.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary" component="dt">
          {label}
        </Typography>
        <Typography variant="body1" component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
          {value}
        </Typography>
      </Box>
      <Button size="small" onClick={() => onEdit(step)} aria-label={`Edit ${label.toLowerCase()}`}>
        {'Edit'}
      </Button>
    </Stack>
  )
}

/** Step: every answer, each with Edit, before "Plan my site". */
export function ReviewStep({
  answers,
  freeTaste,
  onEdit,
  children,
}: {
  answers: AiSiteStartAnswers
  freeTaste: boolean
  onEdit: (step: AiSiteStartStep) => void
  children?: ReactNode
}) {
  const kind = aiSiteStartKind(answers)
  const submissions = AI_SITE_SUBMISSION_CHOICES.find((option) => option.id === answers.submissions)
  const rows: Array<{ label: string; value: ReactNode; step: AiSiteStartStep }> = [
    { label: 'Kind of site', value: answers.siteType.trim(), step: 'kind' },
    { label: 'Who it is for', value: answers.audience.trim() || 'Anyone (not said)', step: 'audience' },
    { label: 'Style', value: answers.kind ? kind.label : `${kind.label}, picked for you`, step: 'style' },
    { label: 'Form submissions', value: submissions?.label ?? answers.submissions, step: 'details' },
    { label: 'Pages', value: String(answers.pages), step: 'details' },
    ...(freeTaste ? [] : [{ label: 'Welcome email', value: answers.welcomeEmail ? 'Draft one' : 'No', step: 'details' as const }]),
  ]
  return (
    <Stack spacing={3}>
      <Box component="dl" data-start-area="review" sx={{ m: 0 }}>
        {rows.map((row, index) => (
          <Fragment key={row.label}>
            {index > 0 && <Divider component="div" />}
            <ReviewRow {...row} onEdit={onEdit} />
          </Fragment>
        ))}
      </Box>
      {children}
    </Stack>
  )
}

/** A step's help beside its heading. */
export function StepHelp({ step }: { step: AiSiteStartStep }) {
  const help = step === 'choose' ? null : START_STEP_HELP[step]
  return help ? <HelpTip sx={{ float: 'right' }} {...help} /> : null
}
