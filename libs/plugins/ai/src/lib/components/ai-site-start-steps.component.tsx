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
  mdiCheck,
  mdiChevronDown,
  mdiCreation,
  mdiHandHeart,
  mdiScaleBalance,
  mdiShopping,
  mdiSilverwareForkKnife,
  mdiViewGridOutline,
  mdiWrench,
} from '@aglyn/shared-data-mdi'
import { HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import { OptionCardGrid } from '@aglyn/shared-ui-jsx/components/option-card-grid.component'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { OpeningHoursPicker } from '@aglyn/shared-ui-jsx/components/weekly-hours-picker.component'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Divider,
  FormHelperText,
  LinearProgress,
  List,
  ListItemButton,
  MenuItem,
  Stack,
  Step,
  StepButton,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Fragment, useId, useState, type ReactNode, type Ref } from 'react'
import { aiSiteHoursSentence, aiSiteServiceAreas, aiSiteSocialLinks } from '../model/ai-site-details'
import { AI_SITE_FREE_PAGES_NOTE, AI_SITE_SUBMISSION_CHOICES, type AiSiteSubmissions } from '../model/ai-site-job'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import {
  AI_SITE_INSPIRATION_LIMITS,
  AI_SITE_INSPIRATION_MAX,
  AI_SITE_INSPIRATION_PAID_NOTE,
  aiSiteInspirationHost,
} from '../model/ai-site-inspiration'
import { SITE_STYLE_AUTO } from '@aglyn/aglyn/app-utils/site-styles'
import {
  AI_SITE_START_TYPES,
  aiSiteStartInspirationTyped,
  aiSiteStartKind,
  aiSiteStartStyleAnswer,
  type AiSiteStartAnswers,
  type AiSiteStartExtraKey,
} from '../model/ai-site-start'
import {
  AI_SITE_START_MORE_FIELDS,
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
      'Your phone number and email, which your pages show, where contact form messages go, how many pages to write, and on paid plans whether to draft a welcome email. All can be changed later.',
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
export const AI_SITE_STYLE_AUTO = SITE_STYLE_AUTO

/**
 * The 21 style cards, each with its example home page (AGL-3898), as the
 * Style step and the starter site's style choice (AGL-4049) both draw them.
 */
export function aiSiteStyleCards(): Array<{
  id: string
  title: string
  description: string
  image?: NonNullable<ReturnType<typeof aiSiteStylePreview>>
}> {
  return AI_SITE_KINDS.map((kind) => {
    const image = aiSiteStylePreview(kind.id)
    return { id: kind.id, title: kind.label, description: kind.blurb, ...(image ? { image } : {}) }
  })
}

/**
 * The progress through the steps: labeled steps on a wide screen, a bar and
 * "Step 3 of 6" on a phone. On a wide screen a step already answered is a
 * button back to it (`onStep`), because a checked step reads as a link: the
 * guided start's dead clicks were people clicking it to go back.
 */
export function StartProgress({
  step,
  compact,
  onStep,
}: {
  step: AiSiteStartStep
  compact: boolean
  onStep?: (step: AiSiteStartStep) => void
}) {
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
      {AI_SITE_START_STEPS.map((id, at) => (
        <Step key={id}>
          {onStep && at < index ? (
            <StepButton onClick={() => onStep(id)} aria-label={`Back to ${AI_SITE_START_STEP_LABELS[id].toLowerCase()}`}>
              {AI_SITE_START_STEP_LABELS[id]}
            </StepButton>
          ) : (
            <StepLabel>{AI_SITE_START_STEP_LABELS[id]}</StepLabel>
          )}
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
 * Step: the style, from cards that show it. Nothing is chosen until a card is
 * clicked (AGL-4049), and the step does not go forward before one is. "Pick
 * for me" is a card too: it leaves the kind unset, so the kind the first
 * answer suggests is the one used, and the card says which.
 *
 * Questions filled in from an AI starter arrive with its style chosen, and
 * `starterStyle` names that card: it says which starter it came from, and
 * that it is the person's to change.
 */
export function StyleStep({
  answers,
  answer,
  tracker,
  errors,
  fieldRef,
  inspiration,
  starterStyle = null,
}: StepProps & {
  inspiration?: AiSiteStartInspirationOffer | null
  starterStyle?: { id: string; name: string } | null
}) {
  const suggested = aiSiteStartKind({ ...answers, kind: null })
  const cards = (
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
        ...aiSiteStyleCards().map((card) =>
          card.id === starterStyle?.id
            ? { ...card, description: `From ${starterStyle.name}. Change it if you like.` }
            : card,
        ),
      ]}
      value={answers.style}
      onChange={(id) => {
        answer(aiSiteStartStyleAnswer(id))
        tracker.fieldPicked('style')
      }}
    />
  )
  const chosen = (
    <Stack spacing={1} data-start-area="field-style">
      {cards}
      {errors.style ? (
        <FormHelperText error role="alert">
          {errors.style.message}
        </FormHelperText>
      ) : null}
    </Stack>
  )
  if (!inspiration) return chosen
  return (
    <Stack spacing={4}>
      {chosen}
      <InspirationFields answers={answers} answer={answer} tracker={tracker} errors={errors} fieldRef={fieldRef} offer={inspiration} />
    </Stack>
  )
}

/**
 * What the guided start offers of Sites I like (AGL-3975), while
 * `release_ai_site_inspiration` is on: how many sites the workspace may name,
 * and where it upgrades for more.
 */
export interface AiSiteStartInspirationOffer {
  limit: number
  upgradeHref: string | null
}

/** Why a Free workspace's second and third site fields are locked. */
export const AI_SITE_INSPIRATION_LOCKED_REASON = `A Free workspace names ${AI_SITE_INSPIRATION_LIMITS.free} site you like. Paid plans name up to ${AI_SITE_INSPIRATION_MAX}.`

/**
 * Sites I like (AGL-3975): up to three addresses under the style cards. A
 * Free workspace's fields past its one are shown disabled with the reason
 * and an upgrade link, never hidden, so the person sees what a paid plan adds.
 */
function InspirationFields({
  answers,
  answer,
  tracker,
  errors,
  fieldRef,
  offer,
}: StepProps & { offer: AiSiteStartInspirationOffer }) {
  const values = answers.inspiration ?? []
  const change = (index: number, value: string) => {
    const next = Array.from({ length: offer.limit }, (_, at) => values[at] ?? '')
    next[index] = value
    answer({ inspiration: next })
    tracker.fieldChanged('inspiration')
  }
  return (
    <Stack spacing={1.5} data-start-area="field-inspiration">
      <Typography variant="overline" color="text.secondary" component="h2">
        {'Sites you like (optional)'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {
          'We take only how they are laid out and styled: the order of sections, colors, type, buttons and motion. Never their words, photos or logos, so your site stays your own.'
        }
      </Typography>
      {Array.from({ length: AI_SITE_INSPIRATION_MAX }, (_, index) => {
        const locked = index >= offer.limit
        const field = (
          <TextField
            fullWidth
            type="url"
            inputMode="url"
            label={`Site ${index + 1}`}
            placeholder="https://example.com"
            value={locked ? '' : (values[index] ?? '')}
            onChange={(event) => change(index, event.target.value)}
            onBlur={() => tracker.fieldLeft('inspiration')}
            {...(index === 0 ? { inputRef: fieldRef('inspiration') } : {})}
            error={index === 0 && Boolean(errors.inspiration)}
            {...(index === 0 && errors.inspiration ? { helperText: errors.inspiration.message } : {})}
          />
        )
        return locked ? (
          <BlockedControl key={index} blocked reason={AI_SITE_INSPIRATION_LOCKED_REASON} fullWidth>
            {field}
          </BlockedControl>
        ) : (
          <Box key={index}>{field}</Box>
        )
      })}
      {offer.limit < AI_SITE_INSPIRATION_MAX && (
        <PrerequisiteNotice {...(offer.upgradeHref ? { href: offer.upgradeHref } : {})} actionLabel="Upgrade">
          {AI_SITE_INSPIRATION_PAID_NOTE}
        </PrerequisiteNotice>
      )}
    </Stack>
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
        How a customer reaches the business (AGL-3979), first: given, the
        pages show them as links — the contact page, the footer, the buttons
        that ask a visitor to call or write — and the site's search listing
        and AI-agent details carry them. Optional, and never a placeholder.
      */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Box data-start-area="field-phone" sx={{ flex: 1 }}>
          <TextField
            fullWidth
            type="tel"
            inputRef={fieldRef('phone')}
            label="Business phone"
            placeholder="(512) 555-0142"
            autoComplete="tel"
            value={answers.phone}
            onChange={(event) => {
              answer({ phone: event.target.value })
              tracker.fieldChanged('phone')
            }}
            {...typed(tracker, 'phone')}
            error={Boolean(errors.phone)}
            helperText={errors.phone?.message ?? 'Optional. Shown on your site so customers can call.'}
            slotProps={{ htmlInput: { inputMode: 'tel' } }}
          />
        </Box>
        <Box data-start-area="field-email" sx={{ flex: 1 }}>
          <TextField
            fullWidth
            type="email"
            inputRef={fieldRef('email')}
            label="Business email"
            placeholder="hello@yourbusiness.com"
            autoComplete="email"
            value={answers.email}
            onChange={(event) => {
              answer({ email: event.target.value })
              tracker.fieldChanged('email')
            }}
            {...typed(tracker, 'email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message ?? 'Optional. Shown on your site so customers can write.'}
          />
        </Box>
      </Stack>
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

/**
 * The brand colors "More details" offers on the Style step (AGL-3979), by
 * name: picking one makes it the site's primary color, held to contrast by
 * the look like any brand color; none leaves the style to choose. Picked,
 * never typed: a color code is not something a site owner should need.
 */
export const AI_SITE_START_BRAND_COLORS: ReadonlyArray<{ label: string; hex: string }> = [
  { label: 'Red', hex: '#c62828' },
  { label: 'Orange', hex: '#e65100' },
  { label: 'Gold', hex: '#b28704' },
  { label: 'Green', hex: '#2e7d32' },
  { label: 'Teal', hex: '#00796b' },
  { label: 'Blue', hex: '#1565c0' },
  { label: 'Navy', hex: '#1a237e' },
  { label: 'Purple', hex: '#6a1b9a' },
  { label: 'Pink', hex: '#ad1457' },
  { label: 'Brown', hex: '#5d4037' },
  { label: 'Charcoal', hex: '#37474f' },
]

/** The price ranges offered, as a search listing writes them. */
const PRICE_RANGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '$', label: '$ — budget' },
  { value: '$$', label: '$$ — moderate' },
  { value: '$$$', label: '$$$ — premium' },
  { value: '$$$$', label: '$$$$ — luxury' },
]

/** What each step's "More details" says it holds, under its title. */
const MORE_SUMMARY: Readonly<Partial<Record<AiSiteStartStep, string>>> = {
  kind: 'Optional: a tagline and the year you started',
  audience: 'Optional: areas you serve, price range and languages',
  style: 'Optional: your brand color',
  details: 'Optional: address, opening hours and social profiles',
}

/** A typed extra's field. */
function ExtraText({
  field,
  answers,
  answer,
  tracker,
  errors,
  fieldRef,
  label,
  placeholder,
  helper,
  autoComplete = 'off',
  multiline = false,
  inputMode,
}: StepProps & {
  field: AiSiteStartExtraKey
  label: string
  placeholder?: string
  helper?: string
  autoComplete?: string
  multiline?: boolean
  inputMode?: 'numeric' | 'url'
}) {
  const error = errors[field]
  return (
    <Box data-start-area={`field-${field}`} sx={{ flex: 1, minWidth: 0 }}>
      <TextField
        fullWidth
        inputRef={fieldRef(field)}
        label={label}
        placeholder={placeholder}
        autoComplete={autoComplete}
        multiline={multiline}
        minRows={multiline ? 2 : undefined}
        value={answers[field]}
        onChange={(event) => {
          answer({ [field]: event.target.value })
          tracker.fieldChanged(field)
        }}
        {...typed(tracker, field)}
        error={Boolean(error)}
        helperText={error?.message ?? helper}
        slotProps={inputMode ? { htmlInput: { inputMode } } : undefined}
      />
    </Box>
  )
}

/** The price range, picked from how search results show one. */
function PriceRangeField({ answers, answer, tracker, errors, fieldRef }: StepProps) {
  const own = answers.priceRange && !PRICE_RANGES.some((option) => option.value === answers.priceRange)
  const options = own ? [...PRICE_RANGES, { value: answers.priceRange, label: answers.priceRange }] : PRICE_RANGES
  return (
    <Box data-start-area="field-priceRange" sx={{ flex: 1, minWidth: 0 }}>
      <TextField
        select
        fullWidth
        inputRef={fieldRef('priceRange')}
        label="Price range"
        value={answers.priceRange}
        onChange={(event) => {
          answer({ priceRange: event.target.value })
          tracker.fieldPicked('priceRange')
        }}
        error={Boolean(errors.priceRange)}
        helperText={errors.priceRange?.message ?? 'How your prices compare, as search results show it.'}
      >
        <MenuItem value="">{'Not said'}</MenuItem>
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  )
}

/**
 * What a brand color the swatches do not name is called (AGL-4049): one an AI
 * starter brought, or a start reopened on its own. Shown as its swatch and by
 * this name, never as a color code.
 */
export const AI_SITE_START_OWN_BRAND_LABEL = 'Chosen color'

/** A brand color's name: a swatch's, else {@link AI_SITE_START_OWN_BRAND_LABEL} for a color code, else as given. */
export function aiSiteStartBrandLabel(brand: string): string {
  const swatch = AI_SITE_START_BRAND_COLORS.find((color) => color.hex === brand)
  if (swatch) return swatch.label
  return /^#[0-9a-f]{6}$/i.test(brand) ? AI_SITE_START_OWN_BRAND_LABEL : brand
}

/** The brand color, picked from named swatches, with a color the swatches do not name kept as one more. */
function BrandField({ answers, answer, tracker }: StepProps) {
  const labelId = useId()
  const own = aiSiteStartBrandLabel(answers.brand) === AI_SITE_START_OWN_BRAND_LABEL ? answers.brand : null
  const swatches = own
    ? [...AI_SITE_START_BRAND_COLORS, { label: AI_SITE_START_OWN_BRAND_LABEL, hex: own }]
    : AI_SITE_START_BRAND_COLORS
  return (
    <Stack spacing={1} data-start-area="field-brand">
      <Typography variant="body2" color="text.secondary" id={labelId}>
        {'Brand color'}
      </Typography>
      <Stack direction="row" role="radiogroup" aria-labelledby={labelId} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {[{ label: 'Let the style choose', hex: '' }, ...swatches].map((color) => {
          const picked = (answers.brand || '') === color.hex
          return (
            <Tooltip key={color.label} title={color.label}>
              <Box
                component="button"
                type="button"
                role="radio"
                aria-checked={picked}
                aria-label={color.label}
                onClick={() => {
                  answer({ brand: color.hex })
                  tracker.fieldPicked('brand')
                }}
                sx={{
                  width: 36,
                  height: 36,
                  p: 0,
                  borderRadius: '50%',
                  border: 2,
                  borderColor: picked ? 'text.primary' : 'divider',
                  bgcolor: color.hex || 'background.paper',
                  color: color.hex ? 'common.white' : 'text.secondary',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                {picked ? <MdiIcon path={mdiCheck.path} fontSize="small" /> : null}
              </Box>
            </Tooltip>
          )
        })}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {'Picked, it is your site’s main color, kept readable everywhere it is used.'}
      </Typography>
    </Stack>
  )
}

/** The opening hours, picked a day at a time: the same editor as Setup → SEO. */
function HoursField({ answers, answer, tracker, errors }: StepProps) {
  return (
    <Box data-start-area="field-hours">
      <OpeningHoursPicker
        label="Opening hours"
        value={answers.hours}
        onChange={(hours) => {
          answer({ hours })
          tracker.fieldPicked('hours')
        }}
        helperText={errors.hours?.message ?? 'Leave every day closed if you work by appointment.'}
      />
    </Box>
  )
}

/** One extra's field, as "More details" draws it. */
function ExtraField({ field, ...props }: StepProps & { field: AiSiteStartExtraKey }) {
  switch (field) {
    case 'tagline':
      return <ExtraText {...props} field={field} label="Tagline" placeholder="Calm, gentle grooming your dog will love" helper="A short line about the business, in your words." />
    case 'founded':
      return <ExtraText {...props} field={field} label="Year founded" placeholder="2015" inputMode="numeric" />
    case 'serviceArea':
      return <ExtraText {...props} field={field} label="Areas you serve" placeholder={'Austin\nRound Rock'} helper="Cities, towns or neighborhoods, one a line." multiline />
    case 'priceRange':
      return <PriceRangeField {...props} />
    case 'languages':
      return <ExtraText {...props} field={field} label="Languages you serve customers in" placeholder="English, Spanish" />
    case 'brand':
      return <BrandField {...props} />
    case 'street':
      return <ExtraText {...props} field={field} label="Street address" placeholder="214 Main Street" autoComplete="street-address" />
    case 'city':
      return <ExtraText {...props} field={field} label="City or town" placeholder="Austin" autoComplete="address-level2" />
    case 'region':
      return <ExtraText {...props} field={field} label="State or region" placeholder="TX" autoComplete="address-level1" />
    case 'postalCode':
      return <ExtraText {...props} field={field} label="ZIP or postal code" placeholder="78701" autoComplete="postal-code" />
    case 'country':
      return <ExtraText {...props} field={field} label="Country" placeholder="United States" autoComplete="country-name" />
    case 'hours':
      return <HoursField {...props} />
    case 'social':
      return (
        <ExtraText
          {...props}
          field={field}
          label="Social profiles"
          placeholder="instagram.com/yourbusiness"
          helper="One link a line. Your site links them, and its search listing names them as yours."
          multiline
          inputMode="url"
        />
      )
    default:
      return null
  }
}

/** Fields "More details" draws side by side. */
const PAIRS: ReadonlyArray<readonly [AiSiteStartExtraKey, AiSiteStartExtraKey]> = [
  ['tagline', 'founded'],
  ['priceRange', 'languages'],
  ['city', 'region'],
  ['postalCode', 'country'],
]

/**
 * A step's "More details" (AGL-3979): a collapsed section of optional extras
 * that fit the step, so a person who wants the site to say more can, and one
 * who does not never has to open it. Open from the start where something in
 * it is already filled in (a start reopened on its answers), and opened by a
 * Next refused on one of its fields.
 */
export function MoreDetails({ step, ...props }: StepProps & { step: AiSiteStartStep }) {
  const fields = AI_SITE_START_MORE_FIELDS[step]
  const { answers, errors, tracker } = props
  const [open, setOpen] = useState(() => fields.some((field) => (answers[field] ?? '').trim() !== ''))
  if (!fields.length) return null
  const expanded = open || fields.some((field) => errors[field])
  const rows: Array<readonly AiSiteStartExtraKey[]> = []
  for (const field of fields) {
    if (rows.some((row) => row.includes(field))) continue
    const pair = PAIRS.find((entry) => entry[0] === field && fields.includes(entry[1]))
    rows.push(pair ?? [field])
  }
  return (
    <Accordion
      disableGutters
      variant="outlined"
      // The same outlined, rounded section as the build page's plan.
      sx={{ borderRadius: 2, '&::before': { display: 'none' } }}
      expanded={expanded}
      onChange={(_, next) => {
        setOpen(next)
        if (next) tracker.moreDetails()
      }}
      data-start-area="more-details"
    >
      <AccordionSummary expandIcon={<MdiIcon path={mdiChevronDown.path} />}>
        <Stack spacing={0.25}>
          <Typography variant="subtitle2" component="span">
            {'More details'}
          </Typography>
          <Typography variant="body2" color="text.secondary" component="span">
            {MORE_SUMMARY[step]}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2.5}>
          {rows.map((row) =>
            row.length > 1 ? (
              <Stack key={row.join('-')} direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {row.map((field) => (
                  <ExtraField key={field} field={field} {...props} />
                ))}
              </Stack>
            ) : (
              <ExtraField key={row[0]} field={row[0]} {...props} />
            ),
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}

/** The extras on the review, each as a person reads it, with the step that asks it. */
export function aiSiteStartExtraRows(answers: AiSiteStartAnswers): Array<{ label: string; value: string; step: AiSiteStartStep }> {
  const rows: Array<{ label: string; value: string; step: AiSiteStartStep }> = []
  const add = (label: string, value: string, step: AiSiteStartStep) => {
    if (value.trim()) rows.push({ label, value: value.trim(), step })
  }
  add('Phone', answers.phone, 'details')
  add('Email', answers.email, 'details')
  add('Tagline', answers.tagline, 'kind')
  add('Year founded', answers.founded, 'kind')
  add('Areas you serve', aiSiteServiceAreas(answers.serviceArea).join(', '), 'audience')
  add('Price range', answers.priceRange, 'audience')
  add('Languages', answers.languages, 'audience')
  add('Brand color', answers.brand ? aiSiteStartBrandLabel(answers.brand) : '', 'style')
  const regional = [answers.region, answers.postalCode].map((part) => part.trim()).filter(Boolean).join(' ')
  const address = [answers.street, answers.city, regional, answers.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
  add('Address', address, 'details')
  add('Opening hours', aiSiteHoursSentence(answers.hours), 'details')
  const links = aiSiteSocialLinks(answers.social) ?? []
  add('Social profiles', links.map((link) => link.replace(/^https:\/\//, '')).join(', '), 'details')
  return rows
}

/**
 * One answer on the review, as one button back to the step that asks it. The
 * whole row is the target, not only "Edit" at its end: people clicked the
 * answer itself to change it, and nothing happened.
 */
function ReviewRow({ label, value, step, onEdit }: { label: string; value: ReactNode; step: AiSiteStartStep; onEdit: (step: AiSiteStartStep) => void }) {
  const valueId = useId()
  return (
    <ListItemButton
      onClick={() => onEdit(step)}
      aria-label={`Edit ${label.toLowerCase()}`}
      aria-describedby={valueId}
      sx={{ alignItems: 'flex-start', gap: 2, py: 1.5, px: 1, mx: -1, borderRadius: 1 }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
          {label}
        </Typography>
        <Typography id={valueId} variant="body1" component="span" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
          {value}
        </Typography>
      </Box>
      <Typography variant="button" color="primary" component="span" aria-hidden sx={{ fontSize: '0.8125rem', pt: 0.25 }}>
        {'Edit'}
      </Typography>
    </ListItemButton>
  )
}

/** Step: every answer, each with Edit, before "Plan my site". */
export function ReviewStep({
  answers,
  freeTaste,
  onEdit,
  children,
  inspiration = false,
}: {
  answers: AiSiteStartAnswers
  freeTaste: boolean
  onEdit: (step: AiSiteStartStep) => void
  children?: ReactNode
  /** Whether the start asks for the sites the person likes (AGL-3975). */
  inspiration?: boolean
}) {
  const liked = aiSiteStartInspirationTyped(answers)
  const kind = aiSiteStartKind(answers)
  const submissions = AI_SITE_SUBMISSION_CHOICES.find((option) => option.id === answers.submissions)
  const rows: Array<{ label: string; value: ReactNode; step: AiSiteStartStep }> = [
    { label: 'Kind of site', value: answers.siteType.trim(), step: 'kind' },
    { label: 'Who it is for', value: answers.audience.trim() || 'Anyone (not said)', step: 'audience' },
    {
      label: 'Style',
      value: answers.style === null ? 'Not chosen yet' : answers.kind ? kind.label : `${kind.label}, picked for you`,
      step: 'style',
    },
    ...(inspiration
      ? [{ label: 'Sites you like', value: liked.length ? liked.map(aiSiteInspirationHost).join(', ') : 'None', step: 'style' as const }]
      : []),
    { label: 'Form submissions', value: submissions?.label ?? answers.submissions, step: 'details' },
    { label: 'Pages', value: String(answers.pages), step: 'details' },
    ...(freeTaste ? [] : [{ label: 'Welcome email', value: answers.welcomeEmail ? 'Draft one' : 'No', step: 'details' as const }]),
    // Everything "More details" and the contact fields were given (AGL-3979), each with Edit.
    ...aiSiteStartExtraRows(answers),
  ]
  return (
    <Stack spacing={3}>
      <List disablePadding data-start-area="review" aria-label="Your answers">
        {rows.map((row, index) => (
          <Fragment key={row.label}>
            {index > 0 && <Divider component="li" aria-hidden />}
            <li>
              <ReviewRow {...row} onEdit={onEdit} />
            </li>
          </Fragment>
        ))}
      </List>
      {children}
    </Stack>
  )
}

/** A step's help beside its heading. */
export function StepHelp({ step }: { step: AiSiteStartStep }) {
  const help = step === 'choose' ? null : START_STEP_HELP[step]
  return help ? <HelpTip sx={{ float: 'right' }} {...help} /> : null
}
