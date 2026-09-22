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
import { useEffect, useMemo, useState } from 'react'
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

/**
 * Sequences → Compliance (AGL-2980): who every email says sent it, the
 * countries a sequence may send to at all, and — below the settings, with
 * no Save of its own — the domains no sequence emails (AGL-3244).
 *
 * The footer is previewed from what is typed, by the engine's own
 * `composeOutreachFooter`, so the page shows the lines every email will end
 * with — or, while the legal name or the address is empty, the sentence
 * that explains why nothing can be sent and no sequence activated.
 */
export function OutreachComplianceSection(
  props: OutreachComplianceSectionProps,
) {
  const { orgId } = props
  const api = useOutreachApi(orgId)
  const loaded = useOutreachComplianceSettings(api, orgId)
  const { enqueueSnackbar } = useSnackbar()
  const [form, setForm] = useState<OutreachComplianceSettings>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [serverIssues, setServerIssues] = useState<
    Partial<Record<OutreachComplianceField, string>>
  >({})
  const countries = useMemo(() => outreachCountryOptions(), [])

  const stored = loaded.settings
  useEffect(() => {
    if (stored) setForm({ ...stored })
  }, [stored])

  const { settings: normalized, issues } =
    validateOutreachComplianceSettings(form)
  const fieldIssue = (field: OutreachComplianceField) =>
    serverIssues[field] ??
    issues.find((issue) => issue.field === field)?.message
  const dirty = stored
    ? !outreachComplianceSettingsEqual(stored, normalized)
    : false
  const footer = composeOutreachFooter(normalized)
  const set = (field: keyof OutreachComplianceSettings) => (value: string) => {
    setServerIssues({})
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const answer = await api.saveSettings(normalized)
      setServerIssues({})
      setForm({ ...answer.settings })
      loaded.reload()
      enqueueSnackbar(
        answer.changed ? 'Compliance settings saved.' : 'Nothing changed.',
        {
          variant: answer.changed ? 'success' : 'info',
        },
      )
    } catch (error) {
      if (error instanceof OutreachRouteError && error.issues.length) {
        setServerIssues(
          Object.fromEntries(
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
        )
      }
      enqueueSnackbar((error as Error).message, {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }

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

  const selectedCountries = form.allowedCountries.map(
    (code) =>
      countries.find((option) => option.code === code) ?? {
        code,
        name: outreachCountryLabel(code),
      },
  )

  return (
    <Stack spacing={2}>
      <CardDisplay
        header="Sender identity"
        help={pluginDocsHelp('sequences', { anchor: '#compliance-settings' })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'Every email a sequence sends ends with a footer naming your organization, its postal ' +
              'address, that the email is a sales email, and how to stop more of them. The law ' +
              'requires these on commercial email, so every email gets the footer automatically.'}
          </Typography>
          <TextField
            label="Legal name"
            value={form.legalName}
            onChange={(event) => set('legalName')(event.target.value)}
            error={Boolean(fieldIssue('legalName'))}
            helperText={
              fieldIssue('legalName') ??
              'Your organization’s legal name, as the footer prints it.'
            }
            slotProps={{
              htmlInput: { maxLength: OUTREACH_LEGAL_NAME_MAX + 20 },
            }}
            fullWidth
          />
          <TextField
            label="Brand name"
            value={form.brandName}
            onChange={(event) => set('brandName')(event.target.value)}
            error={Boolean(fieldIssue('brandName'))}
            helperText={
              fieldIssue('brandName') ??
              'The name the solicitation sentence uses. Leave empty to use the legal name.'
            }
            slotProps={{
              htmlInput: { maxLength: OUTREACH_BRAND_NAME_MAX + 20 },
            }}
            fullWidth
          />
          <TextField
            label="Postal address"
            value={form.postalAddress}
            onChange={(event) => set('postalAddress')(event.target.value)}
            error={Boolean(fieldIssue('postalAddress'))}
            helperText={
              fieldIssue('postalAddress') ?? OUTREACH_POSTAL_ADDRESS_HELP
            }
            slotProps={{
              htmlInput: { maxLength: OUTREACH_POSTAL_ADDRESS_MAX + 40 },
            }}
            multiline
            minRows={3}
            fullWidth
          />
          {footer.footer ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">Every email ends with</Typography>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  data-testid="outreach-footer-preview"
                >
                  {footer.footer}
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

      <CardDisplay
        header="Allowed countries"
        help={pluginDocsHelp('sequences', { anchor: '#allowed-countries' })}
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
          <Autocomplete<OutreachCountryOption, true>
            multiple
            options={countries}
            value={selectedCountries}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.code === value.code}
            onChange={(_event, next) => {
              setServerIssues({})
              setForm((previous) => ({
                ...previous,
                allowedCountries: next.map((option) => option.code),
              }))
            }}
            renderValue={(value, getItemProps) =>
              value.map((option, index) => {
                const { key, ...item } = getItemProps({ index })
                return (
                  <Chip key={key} size="small" label={option.name} {...item} />
                )
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Countries"
                error={Boolean(fieldIssue('allowedCountries'))}
                helperText={fieldIssue('allowedCountries')}
              />
            )}
          />
        </Stack>
      </CardDisplay>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ justifyContent: 'flex-end' }}
      >
        <Button
          variant="text"
          disabled={!dirty || saving}
          onClick={() => {
            setServerIssues({})
            if (stored) setForm({ ...stored })
          }}
        >
          Discard changes
        </Button>
        <Button
          variant="contained"
          disabled={!dirty || saving || issues.length > 0}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Stack>

      {/* Its own list, saved as it is edited (AGL-3244): no Save above it. */}
      <OutreachDoNotContactDomainsCard orgId={orgId} />
    </Stack>
  )
}
OutreachComplianceSection.displayName = 'OutreachComplianceSection'

export default OutreachComplianceSection
