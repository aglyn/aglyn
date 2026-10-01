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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { composeOutreachFooter } from '../engine/compose'
import {
  outreachComplianceSettingsEqual,
  outreachCountryLabel,
  outreachCountryOptions,
  OUTREACH_BRAND_NAME_MAX,
  OUTREACH_LEGAL_NAME_MAX,
  OUTREACH_POSTAL_ADDRESS_MAX,
  validateOutreachComplianceSettings,
  type OutreachComplianceField,
  type OutreachCountryOption,
} from '../model/compliance-settings'
import type { OutreachComplianceSettings } from '../model/outreach.types'
import { OutreachDoNotContactDomainsCard } from './do-not-contact-domains'
import { OutreachLoading, OutreachLoadProblem } from './outreach-ui'
import { OutreachRouteError, useOutreachApi } from './use-outreach-api'
import { useOutreachComplianceSettings } from './use-outreach-settings'

export interface OutreachComplianceSectionProps {
  /** The organization the hub is mounted under; `null` until the shell knows it. */
  orgId: string | null
}

/** What CAN-SPAM accepts as the postal address, as the field says it. */
export const OUTREACH_POSTAL_ADDRESS_HELP =
  'A street address, a post office box registered with the US Postal Service, or a private mailbox ' +
  'registered with the US Postal Service. Every email prints it in its footer.'

const EMPTY: OutreachComplianceSettings = {
  legalName: '',
  brandName: '',
  postalAddress: '',
  allowedCountries: ['US'],
}

type ComplianceCardKey = 'identity' | 'countries'

/**
 * The page's cards and the settings each one owns. Every card saves only its
 * own fields onto what is stored, so saving the countries never commits a
 * half-edited sender identity, and the other way round.
 */
const CARDS: Record<
  ComplianceCardKey,
  { fields: readonly (keyof OutreachComplianceSettings)[]; saved: string }
> = {
  identity: {
    fields: ['legalName', 'brandName', 'postalAddress'],
    saved: 'Sender identity saved.',
  },
  countries: {
    fields: ['allowedCountries'],
    saved: 'Allowed countries saved.',
  },
}

function pickCard(
  settings: OutreachComplianceSettings,
  card: ComplianceCardKey,
): Partial<OutreachComplianceSettings> {
  return Object.fromEntries(
    CARDS[card].fields.map((field) => [field, settings[field]]),
  )
}

function cardEqual(
  card: ComplianceCardKey,
  a: OutreachComplianceSettings,
  b: OutreachComplianceSettings,
): boolean {
  return outreachComplianceSettingsEqual({ ...b, ...pickCard(a, card) }, b)
}

const countryName = (option: OutreachCountryOption): string => option.name
const sameCountry = (
  option: OutreachCountryOption,
  value: OutreachCountryOption,
): boolean => option.code === value.code

/**
 * The allowed countries, as chips — MEMOIZED, and every prop it takes is
 * stable while the countries are (AGL-3423).
 *
 * A multiple Autocomplete hands its input a new chip array as
 * `startAdornment` on every render, and MUI's `InputBase` copies that into
 * its `FormControl` from a passive effect: a state update left pending after
 * every commit the field takes part in. React 19 counts each such commit as a
 * nested update, and keystrokes delivered back to back commit one after
 * another with nothing to clear the count, so the fifty-first throws
 * "Maximum update depth exceeded" (#185) — the sequence editor's countries
 * field did exactly that. The legal name and address share one form with
 * this list, so each keystroke in them re-rendered it; kept out of those
 * renders, it commits only when it changes.
 */
const ComplianceCountriesField = memo(function ComplianceCountriesField(props: {
  options: readonly OutreachCountryOption[]
  value: readonly OutreachCountryOption[]
  issue?: string
  onChange(next: OutreachCountryOption[]): void
}) {
  const { onChange } = props
  return (
    <Autocomplete<OutreachCountryOption, true>
      multiple
      options={props.options}
      value={props.value as OutreachCountryOption[]}
      getOptionLabel={countryName}
      isOptionEqualToValue={sameCountry}
      onChange={(_event, next) => onChange(next)}
      renderValue={(value, getItemProps) =>
        value.map((option, index) => {
          const { key, ...item } = getItemProps({ index })
          return <Chip key={key} size="small" label={option.name} {...item} />
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Countries"
          error={Boolean(props.issue)}
          helperText={props.issue}
        />
      )}
    />
  )
})

/** A text field that redraws only when what it shows changes (AGL-3423). */
const MemoTextField = memo(TextField) as typeof TextField
/** Its own list and listener: nothing typed in the cards above it reaches it. */
const MemoDoNotContactDomainsCard = memo(OutreachDoNotContactDomainsCard)

type FieldChange = { target: { value: string } }

const LEGAL_NAME_SLOT_PROPS = {
  htmlInput: { maxLength: OUTREACH_LEGAL_NAME_MAX + 20 },
}
const BRAND_NAME_SLOT_PROPS = {
  htmlInput: { maxLength: OUTREACH_BRAND_NAME_MAX + 20 },
}
const POSTAL_ADDRESS_SLOT_PROPS = {
  htmlInput: { maxLength: OUTREACH_POSTAL_ADDRESS_MAX + 40 },
}
const FOOTER_PAPER = { p: 1.5 } as const
const FOOTER_TEXT = { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } as const

/** How a card's header actions stand: whether it has edits, and can save them. */
interface ComplianceCardState {
  dirty: boolean
  blocked: boolean
  saving: ComplianceCardKey | null
  onDiscard(card: ComplianceCardKey): void
  onSave(card: ComplianceCardKey): void
}

/** A settings card's header actions: discard its edits, or save its own fields. */
const ComplianceCardActions = memo(function ComplianceCardActions(
  props: ComplianceCardState & { card: ComplianceCardKey },
) {
  const { card, dirty, saving, onDiscard, onSave } = props
  return (
    <Stack direction="row" spacing={1}>
      <Button
        size="small"
        variant="text"
        disabled={!dirty || saving !== null}
        onClick={() => onDiscard(card)}
      >
        Discard changes
      </Button>
      <Button
        size="small"
        variant="contained"
        disabled={!dirty || saving !== null || props.blocked}
        onClick={() => onSave(card)}
      >
        {saving === card ? 'Saving…' : 'Save'}
      </Button>
    </Stack>
  )
})

/**
 * Who every email says sent it, and the footer that says it. Each field is
 * memoized with a handler that keeps its identity, so a letter typed into one
 * redraws that field and the footer it changes, not the other two.
 */
const ComplianceIdentityCard = memo(function ComplianceIdentityCard(
  props: ComplianceCardState & {
    legalName: string
    brandName: string
    postalAddress: string
    legalNameIssue?: string
    brandNameIssue?: string
    postalAddressIssue?: string
    /** The footer every email ends with, or `null` while it cannot be composed. */
    footer: string | null
    onLegalName(event: FieldChange): void
    onBrandName(event: FieldChange): void
    onPostalAddress(event: FieldChange): void
  },
) {
  const { footer } = props
  return (
    <CardDisplay
      header="Sender identity"
      help={pluginDocsHelp('sequences', { anchor: '#compliance-settings' })}
      HeaderProps={{
        action: (
          <ComplianceCardActions
            card="identity"
            dirty={props.dirty}
            blocked={props.blocked}
            saving={props.saving}
            onDiscard={props.onDiscard}
            onSave={props.onSave}
          />
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Every email a sequence sends ends with a footer naming your organization, its postal ' +
            'address, that the email is a sales email, and how to stop more of them. The law ' +
            'requires these on commercial email, so every email gets the footer automatically.'}
        </Typography>
        <MemoTextField
          label="Legal name"
          value={props.legalName}
          onChange={props.onLegalName}
          error={Boolean(props.legalNameIssue)}
          helperText={
            props.legalNameIssue ??
            'Your organization’s legal name, as the footer prints it.'
          }
          slotProps={LEGAL_NAME_SLOT_PROPS}
          fullWidth
        />
        <MemoTextField
          label="Brand name"
          value={props.brandName}
          onChange={props.onBrandName}
          error={Boolean(props.brandNameIssue)}
          helperText={
            props.brandNameIssue ??
            'The name the solicitation sentence uses. Leave empty to use the legal name.'
          }
          slotProps={BRAND_NAME_SLOT_PROPS}
          fullWidth
        />
        <MemoTextField
          label="Postal address"
          value={props.postalAddress}
          onChange={props.onPostalAddress}
          error={Boolean(props.postalAddressIssue)}
          helperText={props.postalAddressIssue ?? OUTREACH_POSTAL_ADDRESS_HELP}
          slotProps={POSTAL_ADDRESS_SLOT_PROPS}
          multiline
          minRows={3}
          fullWidth
        />
        {footer ? (
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">Every email ends with</Typography>
            <Paper variant="outlined" sx={FOOTER_PAPER}>
              <Typography
                variant="body2"
                sx={FOOTER_TEXT}
                data-testid="outreach-footer-preview"
              >
                {footer}
              </Typography>
            </Paper>
          </Stack>
        ) : (
          <Alert severity="warning">
            {'No sequence can be activated, and no email sent, until you add your organization’s legal ' +
              'name and postal address.'}
          </Alert>
        )}
      </Stack>
    </CardDisplay>
  )
})

/** The countries a sequence may send to at all. */
const ComplianceCountriesCard = memo(function ComplianceCountriesCard(
  props: ComplianceCardState & {
    options: readonly OutreachCountryOption[]
    value: readonly OutreachCountryOption[]
    issue?: string
    onChange(next: OutreachCountryOption[]): void
  },
) {
  return (
    <CardDisplay
      header="Allowed countries"
      help={pluginDocsHelp('sequences', { anchor: '#allowed-countries' })}
      HeaderProps={{
        action: (
          <ComplianceCardActions
            card="countries"
            dirty={props.dirty}
            blocked={props.blocked}
            saving={props.saving}
            onDiscard={props.onDiscard}
            onSave={props.onSave}
          />
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Sequences may send only to people in these countries, and every sequence only to the ones ' +
            'it and this list both allow. The United States is the default: Canada, the United Kingdom and most ' +
            'of the European Union require a consent basis that an email to someone who never contacted ' +
            'you does not have, so a cold email never goes outside the United States whatever this list ' +
            'says. Add another country only for people who came to you first.'}
        </Typography>
        <ComplianceCountriesField
          options={props.options}
          value={props.value}
          issue={props.issue}
          onChange={props.onChange}
        />
      </Stack>
    </CardDisplay>
  )
})

/**
 * Sequences → Compliance (AGL-2980): who every email says sent it, the
 * countries a sequence may send to at all, and — below the settings, with
 * no Save of its own — the domains no sequence emails (AGL-3244). Each
 * settings card saves its own fields from its header, the console's place
 * for a card's actions (AGL-3333).
 *
 * The footer is previewed from what is typed, by the engine's own
 * `composeOutreachFooter`, so the page shows the lines every email will end
 * with — or, while the legal name or the address is empty, the sentence
 * that explains why nothing can be sent and no sequence activated.
 *
 * Both settings cards are drawn from the one form, and each is memoized and
 * handed only what it shows, through handlers that keep their identity
 * (AGL-3423): a letter typed into the sender identity redraws its field and
 * the footer, not the other fields, the countries or the domain list.
 */
export function OutreachComplianceSection(
  props: OutreachComplianceSectionProps,
) {
  const { orgId } = props
  const api = useOutreachApi(orgId)
  const loaded = useOutreachComplianceSettings(api, orgId)
  const { enqueueSnackbar } = useSnackbar()
  const [form, setForm] = useState<OutreachComplianceSettings>(EMPTY)
  const [saving, setSaving] = useState<ComplianceCardKey | null>(null)
  const [serverIssues, setServerIssues] = useState<
    Partial<Record<OutreachComplianceField, string>>
  >({})
  const countries = useMemo(() => outreachCountryOptions(), [])

  const stored = loaded.settings
  const previousStored = useRef<OutreachComplianceSettings | null>(null)
  useEffect(() => {
    if (!stored) return
    const before = previousStored.current
    previousStored.current = stored
    // A fresh read replaces every card the member has not touched; a card
    // with unsaved edits keeps them, so saving one card never wipes another.
    setForm((current) => {
      if (!before) return { ...stored }
      let next: OutreachComplianceSettings = { ...stored }
      for (const card of Object.keys(CARDS) as ComplianceCardKey[]) {
        if (!cardEqual(card, current, before)) {
          next = { ...next, ...pickCard(current, card) }
        }
      }
      return next
    })
  }, [stored])

  const { settings: normalized, issues } =
    validateOutreachComplianceSettings(form)
  const fieldIssue = (field: OutreachComplianceField) =>
    serverIssues[field] ??
    issues.find((issue) => issue.field === field)?.message
  /** What saving one card would store: its own fields over the stored rest. */
  const candidate = (card: ComplianceCardKey) =>
    validateOutreachComplianceSettings(
      stored ? { ...stored, ...pickCard(form, card) } : form,
    )
  const cardDirty = (card: ComplianceCardKey) =>
    stored
      ? !outreachComplianceSettingsEqual(stored, candidate(card).settings)
      : false
  const cardBlocked = (card: ComplianceCardKey) =>
    candidate(card).issues.some((issue) =>
      (CARDS[card].fields as readonly string[]).includes(issue.field),
    )
  const footer = composeOutreachFooter(normalized)
  const set = useCallback(
    (field: keyof OutreachComplianceSettings, value: string) => {
      setServerIssues((previous) => {
        const next = { ...previous }
        delete next[field as OutreachComplianceField]
        return next
      })
      setForm((previous) => ({ ...previous, [field]: value }))
    },
    [],
  )
  const setLegalName = useCallback(
    (event: FieldChange) => set('legalName', event.target.value),
    [set],
  )
  const setBrandName = useCallback(
    (event: FieldChange) => set('brandName', event.target.value),
    [set],
  )
  const setPostalAddress = useCallback(
    (event: FieldChange) => set('postalAddress', event.target.value),
    [set],
  )

  const clearIssues = (card: ComplianceCardKey) =>
    setServerIssues((previous) => {
      const next = { ...previous }
      for (const field of CARDS[card].fields) {
        delete next[field as OutreachComplianceField]
      }
      return next
    })

  // Stable, for the memoized countries field: an edit clears the card's
  // issues and replaces the list in whatever form it lands on.
  const setCountries = useCallback((next: OutreachCountryOption[]) => {
    setServerIssues((previous) => {
      const cleared = { ...previous }
      for (const field of CARDS.countries.fields) {
        delete cleared[field as OutreachComplianceField]
      }
      return cleared
    })
    setForm((previous) => ({
      ...previous,
      allowedCountries: next.map((option) => option.code),
    }))
  }, [])
  const allowedCountries = form.allowedCountries
  const selectedCountries = useMemo(
    () =>
      allowedCountries.map(
        (code) =>
          countries.find((option) => option.code === code) ?? {
            code,
            name: outreachCountryLabel(code),
          },
      ),
    [allowedCountries, countries],
  )

  const discard = (card: ComplianceCardKey) => {
    clearIssues(card)
    if (stored)
      setForm((previous) => ({ ...previous, ...pickCard(stored, card) }))
  }

  const save = async (card: ComplianceCardKey) => {
    setSaving(card)
    try {
      const answer = await api.saveSettings(candidate(card).settings)
      clearIssues(card)
      setForm((previous) => ({
        ...previous,
        ...pickCard(answer.settings, card),
      }))
      loaded.reload()
      enqueueSnackbar(answer.changed ? CARDS[card].saved : 'Nothing changed.', {
        variant: answer.changed ? 'success' : 'info',
      })
    } catch (error) {
      if (error instanceof OutreachRouteError && error.issues.length) {
        setServerIssues((previous) => ({
          ...previous,
          ...Object.fromEntries(
            error.issues
              .filter(
                (
                  issue,
                ): issue is {
                  field: OutreachComplianceField
                  message: string
                } => 'field' in issue,
              )
              .map((issue) => [issue.field, issue.message]),
          ),
        }))
      }
      enqueueSnackbar((error as Error).message, {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(null)
    }
  }

  // The discard and save as last drawn, behind handlers that keep their
  // identity: both read the form and the stored settings of that render.
  const drawn = useRef({ discard, save })
  drawn.current = { discard, save }
  const onDiscard = useCallback(
    (card: ComplianceCardKey) => drawn.current.discard(card),
    [],
  )
  const onSave = useCallback(
    (card: ComplianceCardKey) => void drawn.current.save(card),
    [],
  )

  if (loaded.status === 'loading' || (!orgId && !stored)) {
    return <OutreachLoading label="Loading compliance settings…" />
  }
  if (loaded.status === 'error' || loaded.status === 'refused') {
    return (
      <OutreachLoadProblem
        status={loaded.status}
        what="compliance settings"
        message={loaded.message}
        onRetry={loaded.reload}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <ComplianceIdentityCard
        legalName={form.legalName}
        brandName={form.brandName}
        postalAddress={form.postalAddress}
        legalNameIssue={fieldIssue('legalName')}
        brandNameIssue={fieldIssue('brandName')}
        postalAddressIssue={fieldIssue('postalAddress')}
        footer={footer.footer}
        onLegalName={setLegalName}
        onBrandName={setBrandName}
        onPostalAddress={setPostalAddress}
        dirty={cardDirty('identity')}
        blocked={cardBlocked('identity')}
        saving={saving}
        onDiscard={onDiscard}
        onSave={onSave}
      />

      <ComplianceCountriesCard
        options={countries}
        value={selectedCountries}
        issue={fieldIssue('allowedCountries')}
        onChange={setCountries}
        dirty={cardDirty('countries')}
        blocked={cardBlocked('countries')}
        saving={saving}
        onDiscard={onDiscard}
        onSave={onSave}
      />

      {/* Its own list, saved as it is edited (AGL-3244): it has no Save. */}
      <MemoDoNotContactDomainsCard orgId={orgId} />
    </Stack>
  )
}
OutreachComplianceSection.displayName = 'OutreachComplianceSection'

export default OutreachComplianceSection
