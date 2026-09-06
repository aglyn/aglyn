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

import {
  type AglynOrgBilling,
  createResourceUid,
  CRM_COLLECTIONS,
} from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Autocomplete,
  Button,
  createFilterOptions,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { crmVisibleToClause, useCrmScope } from '../hooks/use-crm-scope'
import {
  type CompanyOption,
  companyDraftFields,
  EMPTY_COMPANY_DRAFT,
  suggestCompanyForEmail,
} from '../model/companies'

export { suggestCompanyForEmail, type CompanyOption }

/**
 * How many companies the picker lists.
 *
 * A ceiling and not a page: somebody choosing a company knows which one, and
 * a workspace past two hundred accounts finds it from the company list's own
 * search and links the person from there. Bounded because this read happens
 * on a contact's page, where the company list is a control and not the
 * subject.
 */
export const COMPANY_OPTIONS_LIMIT = 200

export interface CompanyOptions {
  options: CompanyOption[]
  /** The listen has answered at least once. */
  ready: boolean
  /** The ceiling cut the list, so a company can exist and not be offered. */
  truncated: boolean
}

/**
 * The companies this viewer may link a contact to, alphabetically
 * (AGL-2597).
 *
 * Read under the same `visibleTo` predicate the company list runs, because
 * the rules refuse a listen without it for a scoped member — and because a
 * picker offering a company the reader could not open would let them file a
 * person under a record they cannot see. Ordered by `nameLower`, the key
 * every company write stores, so the picker reads as a list of names rather
 * than as document-id order dressed up.
 *
 * `enabled` gates the listen: a contact's properties card has one picker and
 * a merchant who opened the record to read a note must not pay for the
 * company list.
 */
export function useCompanyOptions(props: {
  /** The site whose console is reading, or `null` at the organization level. */
  hostId: string | null
  org?: Partial<AglynOrgBilling> | null
  enabled?: boolean
}): CompanyOptions {
  const { hostId, org, enabled = true } = props
  const firestore = useFirestore()
  const { scope, visibleTo } = useCrmScope({ hostId, org })
  const { data, status } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      enabled && scope
        ? query(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies),
            ...crmVisibleToClause(visibleTo),
            orderBy('nameLower'),
            limit(COMPANY_OPTIONS_LIMIT + 1),
          )
        : null,
    [firestore, scope, visibleTo, enabled],
    { idField: '$id' },
  )
  const options = useMemo<CompanyOption[]>(
    () =>
      (data ?? []).slice(0, COMPANY_OPTIONS_LIMIT).map((row) => ({
        id: String(row['$id']),
        name: String(row['name'] ?? ''),
        domain: typeof row['domain'] === 'string' ? row['domain'] : null,
      })),
    [data],
  )
  return {
    options,
    ready: Boolean(scope) && status !== 'loading',
    truncated: (data?.length ?? 0) > COMPANY_OPTIONS_LIMIT,
  }
}

/**
 * Create a company by name, answering the option the picker then selects.
 * Rejects with the sentence to show when the name cannot be stored.
 */
export type CreateCompany = (name: string) => Promise<CompanyOption>

/**
 * The write behind "Create “Acme”" in the picker (AGL-2613).
 *
 * The same document the company drawer writes for a create — the search
 * keys, the scope every CRM creator stamps, the provenance — with only the
 * name filled in, because that is all the picker asked for: the domain, the
 * address and the rest are the company page's to add. The person filing it
 * owns it, as the drawer seeds too. `null` until the org has resolved, so a
 * picker offered before the scope is known offers no create.
 */
export function useCreateCompany(props: {
  /** The site whose console is creating, or `null` at the organization level. */
  hostId: string | null
  org?: Partial<AglynOrgBilling> | null
}): CreateCompany | null {
  const { hostId, org } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  // The provenance and the scope both come from the site the record is
  // captured by — the mounted one, or at the organization level the one the
  // reader picked (AGL-2630). No site picked, no create offered.
  const { scope, createTokens, createHostId } = useCrmScope({ hostId, org })
  const uid = user?.uid ?? ''
  return useMemo<CreateCompany | null>(() => {
    if (!scope || !createHostId) return null
    return async (name) => {
      const result = companyDraftFields({
        ...EMPTY_COMPANY_DRAFT,
        name,
        ownerUid: uid,
      })
      if (result.ok === false) throw new Error(result.error)
      const id = createResourceUid()
      await setDoc(
        doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies, id),
        {
          ...result.set,
          visibleTo: [...createTokens],
          hostId: createHostId,
          createdByUid: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      )
      return { id, name: String(result.set['name']), domain: null }
    }
  }, [scope, createTokens, firestore, createHostId, uid])
}

/** The sentinel id of the "Create …" row the list grows when nothing matches. */
const CREATE_OPTION_ID = '__create__'

type PickerOption = CompanyOption | { id: typeof CREATE_OPTION_ID; name: string; create: string }

const isCreateOption = (
  option: PickerOption,
): option is Extract<PickerOption, { create: string }> => 'create' in option

const filterCompanies = createFilterOptions<PickerOption>({
  stringify: (option) =>
    isCreateOption(option)
      ? option.create
      : option.domain
        ? `${option.name} ${option.domain}`
        : option.name,
})

const optionLabel = (option: PickerOption): string =>
  isCreateOption(option)
    ? `Create “${option.create}”`
    : option.domain
      ? `${option.name} · ${option.domain}`
      : option.name

export interface CompanyPickerProps {
  options: readonly CompanyOption[]
  /** The linked company's id, or `null` for none. */
  value: string | null
  /**
   * The choice, with the option behind it when the list — or a create — can
   * name it, so a caller can echo the company's name onto the contact
   * without a second lookup. `null` for a company the list does not carry.
   */
  onChange: (companyId: string | null, company: CompanyOption | null) => void
  /**
   * Create a company from the typed name and select it. Absent — or `null`
   * while the scope is unresolved — the picker offers no create row.
   */
  onCreate?: CreateCompany | null
  label?: string
  helperText?: string
  disabled?: boolean
  /**
   * The contact's email address, when the caller has one. A company whose
   * domain matches it is offered as a suggestion beneath the field — a
   * suggestion and never an automatic link, because the person who typed
   * `@acme.com` may be a contractor, a customer of Acme's, or Acme itself.
   */
  email?: string | null
  /**
   * The company name the record carries as free text while no company is
   * linked — an import, or a save from before the picker existed. Offered
   * beneath the field as the company to link or create, so the label a
   * merchant already typed is one click from becoming the record it names.
   */
  fallbackName?: string | null
  /** The option list has answered; until then the field says it is loading. */
  ready?: boolean
  /** The list was cut at the ceiling, so the field says to narrow by typing. */
  truncated?: boolean
}

/**
 * One company, chosen from the list a contact may be filed under
 * (AGL-2597, AGL-2613).
 *
 * A search over the loaded list rather than free text, because the value is
 * a document id and a typed name is how two records called "Acme" come to
 * exist. Typing narrows by name and domain; a name nothing matches grows the
 * list by one row, "Create “…”", which writes the company and selects it —
 * so the person filing a contact never has to leave the form to make the
 * account it belongs to. The clear control is the unlink: a saved contact
 * with no company reads as a decision rather than a field somebody skipped.
 *
 * A stored id the list does not carry — a company past the picker's ceiling,
 * or one this viewer cannot see — still renders as SOMETHING selected, or
 * the field would read empty for a contact that has a company and the next
 * save would silently unlink them.
 */
export function CompanyPicker(props: CompanyPickerProps) {
  const {
    options,
    value,
    onChange,
    onCreate,
    label = 'Company',
    helperText,
    disabled,
    email,
    fallbackName,
    ready = true,
    truncated,
  } = props
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const suggestion = useMemo(
    () => (email ? suggestCompanyForEmail(email, options) : null),
    [email, options],
  )
  const fallback = useMemo(() => {
    const name = String(fallbackName ?? '').trim()
    if (value || !name) return null
    const lower = name.toLowerCase()
    return {
      name,
      match: options.find((option) => option.name.trim().toLowerCase() === lower) ?? null,
    }
  }, [fallbackName, options, value])

  const selected = useMemo<PickerOption | null>(() => {
    if (!value) return null
    return (
      options.find((option) => option.id === value) ?? {
        id: value,
        name: `Company ${value.slice(-6)}`,
        domain: null,
      }
    )
  }, [options, value])
  /*
   * The list the control searches: every option, plus the placeholder for a
   * stored id the list does not carry, so the selected value is always one
   * of the options and the control never reports it as invalid.
   */
  const listed = useMemo<PickerOption[]>(
    () =>
      selected && !options.some((option) => option.id === selected.id)
        ? [selected, ...options]
        : [...options],
    [options, selected],
  )

  const create = useCallback(
    async (name: string) => {
      if (!onCreate) return
      setCreating(true)
      setCreateError('')
      try {
        const company = await onCreate(name)
        onChange(company.id, company)
      } catch (error) {
        setCreateError(
          error instanceof Error && error.message
            ? error.message
            : 'The company could not be created.',
        )
      } finally {
        setCreating(false)
      }
    },
    [onCreate, onChange],
  )

  const busy = disabled || !ready || creating
  return (
    <Stack spacing={0.5}>
      <Autocomplete<PickerOption, false, false, false>
        size="small"
        options={listed}
        value={selected}
        disabled={busy}
        loading={!ready}
        getOptionLabel={optionLabel}
        isOptionEqualToValue={(option, current) => option.id === current.id}
        filterOptions={(candidates, state) => {
          const filtered = filterCompanies(candidates, state)
          const typed = state.inputValue.trim()
          const exact = typed.toLowerCase()
          const named = candidates.some(
            (option) =>
              !isCreateOption(option) && option.name.trim().toLowerCase() === exact,
          )
          if (onCreate && typed && !named) {
            filtered.push({ id: CREATE_OPTION_ID, name: typed, create: typed })
          }
          return filtered
        }}
        onChange={(_event, next) => {
          if (!next) return onChange(null, null)
          if (isCreateOption(next)) return void create(next.create)
          onChange(next.id, next)
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            error={Boolean(createError)}
            helperText={
              !ready
                ? 'Loading companies…'
                : creating
                  ? 'Creating the company…'
                  : createError ||
                    helperText ||
                    (truncated
                      ? `The first ${COMPANY_OPTIONS_LIMIT} by name — type to narrow, or create one.`
                      : undefined)
            }
          />
        )}
      />
      {suggestion && suggestion.id !== value ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {`Suggested from the email address: ${suggestion.name}`}
          </Typography>
          <Button
            size="small"
            disabled={busy}
            onClick={() => onChange(suggestion.id, suggestion)}
          >
            {'Use'}
          </Button>
        </Stack>
      ) : fallback ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {fallback.match
              ? `Recorded as “${fallback.name}” — a company by that name exists.`
              : `Recorded as “${fallback.name}” without a link.`}
          </Typography>
          {fallback.match ? (
            <Button
              size="small"
              disabled={busy}
              onClick={() => onChange(fallback.match?.id ?? null, fallback.match)}
            >
              {'Use'}
            </Button>
          ) : onCreate ? (
            <Button size="small" disabled={busy} onClick={() => void create(fallback.name)}>
              {`Create “${fallback.name}”`}
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  )
}
CompanyPicker.displayName = 'CompanyPicker'

export default CompanyPicker
