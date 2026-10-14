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

import { aiAddonName } from '@aglyn/aglyn'
import {
  BUSINESS_PROFILE_FIELDS,
  BUSINESS_PROFILE_MAX_CHARS,
  BUSINESS_PROFILE_MAX_SERVICES,
  BUSINESS_PROFILE_ORIGIN_LABELS,
  BUSINESS_PROFILE_SITE_DOC,
  BUSINESS_PROFILE_SUBCOLLECTION,
  BUSINESS_PROFILE_WORKSPACE_DOC,
  BUSINESS_TONES,
  BUSINESS_TONE_LABELS,
  businessProfileOwnerWrite,
  businessProfileSourceOf,
  resolveBusinessProfile,
  type BusinessProfileDoc,
  type BusinessProfileField,
  type BusinessProfileHost,
  type BusinessProfileValues,
  type ResolvedBusinessProfile,
} from '@aglyn/aglyn/app-utils/business-profile'
import { useLoading } from '@aglyn/shared-ui-jsx'
import {
  FieldComponentType,
  FieldValidatorType,
  FormRenderer,
  type FormSchema,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useUser, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useCallback, useMemo } from 'react'
import { docsHelp } from '../constants/docs-links'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import CardDisplayFormTemplate from './card-display-form-template'

export interface BusinessProfileCardProps {
  orgId: string
  /** The site; absent for the workspace defaults. */
  hostId?: string
  /** `false` shows the form read-only, for a member who may not write it. */
  canEdit?: boolean
}

/** The form's own values: services are one per line in a text box. */
export type FormValues = Partial<Record<Exclude<BusinessProfileField, 'services'>, string>> & { services?: string }

export const toForm = (stored: BusinessProfileDoc | null | undefined): FormValues => ({
  whatYouDo: stored?.whatYouDo ?? '',
  services: (stored?.services ?? []).join('\n'),
  serviceArea: stored?.serviceArea ?? '',
  audience: stored?.audience ?? '',
  tone: stored?.tone ?? '',
  toneNotes: stored?.toneNotes ?? '',
})

export const fromForm = (values: FormValues): BusinessProfileValues => ({
  whatYouDo: values.whatYouDo ?? '',
  services: String(values.services ?? '').split('\n'),
  serviceArea: values.serviceArea ?? '',
  audience: values.audience ?? '',
  tone: (BUSINESS_TONES as readonly string[]).includes(values.tone ?? '')
    ? (values.tone as BusinessProfileValues['tone'])
    : null,
  toneNotes: values.toneNotes ?? '',
})

/**
 * One line under a field saying where the value Aglyn AI reads comes from
 * (AGL-3661). The owner sees a suggestion as a suggestion, and an empty box
 * that is not empty to the AI — the SEO entity's description, a workspace
 * default — says what fills it.
 */
export function originLine(
  field: Exclude<BusinessProfileField, 'toneNotes'> | 'toneNotes',
  stored: BusinessProfileDoc | null | undefined,
  resolved: ResolvedBusinessProfile | null,
  level: 'site' | 'workspace',
  fallback: string,
): string {
  const source = businessProfileSourceOf(stored, field)
  if (source === 'start' || source === 'ai') {
    return `${BUSINESS_PROFILE_ORIGIN_LABELS[source]}. Edit it and it becomes yours.`
  }
  if (source === 'owner') return fallback
  const used = resolved?.[field]
  if (level === 'site' && used && (used.origin === 'site' || used.origin === 'workspace')) {
    const value = Array.isArray(used.value) ? used.value.join(', ') : String(used.value)
    const shown =
      field === 'tone' ? BUSINESS_TONE_LABELS[used.value as keyof typeof BUSINESS_TONE_LABELS] : value
    return `Empty here, so ${aiAddonName()} uses “${shown.length > 80 ? `${shown.slice(0, 79)}…` : shown}” from ${
      used.origin === 'site' ? 'your SEO settings' : 'the workspace defaults'
    }.`
  }
  return fallback
}

function profileSchema(
  level: 'site' | 'workspace',
  stored: BusinessProfileDoc | null | undefined,
  resolved: ResolvedBusinessProfile | null,
  canEdit: boolean,
): FormSchema {
  const line = (field: BusinessProfileField, fallback: string) =>
    originLine(field, stored, resolved, level, fallback)
  const max = (field: Exclude<BusinessProfileField, 'tone'>, message: string) => ({
    type: FieldValidatorType.MAX_LENGTH,
    threshold: BUSINESS_PROFILE_MAX_CHARS[field],
    message,
  })
  const half = { size: { xs: 12, sm: 6 } }
  return {
    id: level === 'site' ? 'hostBusinessProfile' : 'orgBusinessProfile',
    title: level === 'site' ? 'Business profile' : 'Business profile defaults',
    CardDisplayProps: {
      subheader:
        level === 'site'
          ? `What this business does and how it speaks. ${aiAddonName()} reads it on every job for this site, and never replaces what you write here.`
          : 'What every site in this workspace starts from. A site’s own profile wins wherever it says something.',
      help:
        level === 'site'
          ? docsHelp('businessProfile', {
              anchor: '#the-business-profile-card',
              excerpt: `The services, area, audience and tone ${aiAddonName()} writes for. Contact details come only from your site settings.`,
            })
          : docsHelp('businessProfile', {
              anchor: '#workspace-defaults',
              excerpt: 'Defaults a site inherits where its own business profile is empty. Only managers can change them.',
            }),
    },
    fields: [
      {
        component: FieldComponentType.TEXTAREA,
        name: 'whatYouDo',
        label: 'What the business does',
        placeholder: 'Mobile dog grooming for busy owners in north Austin',
        rows: 2,
        isReadOnly: !canEdit,
        helperText: line('whatYouDo', 'One sentence, as you would say it to a new customer'),
        validate: [max('whatYouDo', 'Please keep it to one sentence')],
      },
      {
        component: FieldComponentType.TEXTAREA,
        name: 'services',
        label: 'Services',
        placeholder: 'Full groom\nBath and brush\nNail trim',
        rows: 4,
        isReadOnly: !canEdit,
        helperText: line('services', `One per line, up to ${BUSINESS_PROFILE_MAX_SERVICES}`),
        FormFieldGridProps: half,
      },
      {
        component: FieldComponentType.TEXTAREA,
        name: 'audience',
        label: 'Who it is for',
        placeholder: 'Dog owners who work long hours',
        rows: 4,
        isReadOnly: !canEdit,
        helperText: line('audience', 'The customers you want more of'),
        validate: [max('audience', 'Please enter a shorter description')],
        FormFieldGridProps: half,
      },
      {
        component: FieldComponentType.TEXT_FIELD,
        name: 'serviceArea',
        label: 'Area served',
        placeholder: 'North Austin, Round Rock and Cedar Park',
        isReadOnly: !canEdit,
        helperText: line('serviceArea', 'Cities, regions or “online”'),
        validate: [max('serviceArea', 'Please enter a shorter area')],
        FormFieldGridProps: half,
      },
      {
        component: FieldComponentType.SELECT,
        name: 'tone',
        label: 'Tone of voice',
        isReadOnly: !canEdit,
        helperText: line('tone', 'How the copy should sound'),
        options: [
          { value: '', label: 'Not set' },
          ...BUSINESS_TONES.map((tone) => ({ value: tone, label: BUSINESS_TONE_LABELS[tone] })),
        ],
        FormFieldGridProps: half,
      },
      {
        component: FieldComponentType.TEXT_FIELD,
        name: 'toneNotes',
        label: 'Notes on tone',
        placeholder: 'Say “pups”, never “pets”. No exclamation marks.',
        isReadOnly: !canEdit,
        helperText: line('toneNotes', 'Words to use or avoid, in your own words'),
        validate: [max('toneNotes', 'Please enter shorter notes')],
      },
    ],
  }
}

/**
 * A site's business profile, or the workspace's defaults (AGL-3661): the
 * services, audience, area and tone that have no other home, and that every
 * AI job for the site reads.
 *
 * The save is the OWNER's write: `businessProfileOwnerWrite` makes every
 * field they changed theirs and leaves a field they did not touch with the
 * source it had, so saving after correcting one line does not claim every
 * suggestion on the card. Guarded by the seed like every settings card: a
 * form seeded from a read that failed, or from cache, never writes back.
 */
export function BusinessProfileCard(props: BusinessProfileCardProps) {
  const { orgId, hostId, canEdit = true } = props
  const level = hostId ? 'site' : 'workspace'
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const profileRef = useMemo(
    () =>
      hostId
        ? doc(firestore, 'hosts', hostId, BUSINESS_PROFILE_SUBCOLLECTION, BUSINESS_PROFILE_SITE_DOC)
        : doc(firestore, 'orgs', orgId, BUSINESS_PROFILE_SUBCOLLECTION, BUSINESS_PROFILE_WORKSPACE_DOC),
    [firestore, hostId, orgId],
  )
  const { data: stored, status, fromCache } = useFirestoreDoc<BusinessProfileDoc>(
    () => profileRef,
    [firestore, hostId, orgId],
  )
  // The site's level also shows what fills an empty box: its own settings
  // and the workspace defaults, read the way every AI job reads them.
  const { data: host } = useFirestoreDoc<BusinessProfileHost>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
  )
  const { data: workspace } = useFirestoreDoc<BusinessProfileDoc>(
    () => (hostId ? doc(firestore, 'orgs', orgId, BUSINESS_PROFILE_SUBCOLLECTION, BUSINESS_PROFILE_WORKSPACE_DOC) : null),
    [firestore, hostId, orgId],
  )
  const resolved = useMemo(
    () => (hostId ? resolveBusinessProfile({ host: host ?? null, site: stored ?? null, workspace: workspace ?? null }) : null),
    [host, hostId, stored, workspace],
  )
  const schema = useMemo(() => profileSchema(level, stored, resolved, canEdit), [canEdit, level, resolved, stored])
  const initialValues = useMemo(() => toForm(stored), [stored])

  const handleSave = useCallback(
    async (values: FormValues) => {
      const dequeueLoading = queueLoading()
      try {
        const verdict = await writeGuardedBySeed(
          { subject: 'business profile', unreadable: status === 'error', fromCache },
          async () => {
            const next = businessProfileOwnerWrite(stored ?? null, fromForm(values))
            await setDoc(
              profileRef,
              { ...next, updatedAt: serverTimestamp(), updatedBy: user?.uid ?? null },
              // Only the profile's own fields: `sources` is replaced whole,
              // so a field's source never outlives its value.
              { mergeFields: [...BUSINESS_PROFILE_FIELDS, 'sources', 'updatedAt', 'updatedBy'] },
            )
          },
        )
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message, { variant: 'error' })
          return
        }
        enqueueSnackbar('Business profile saved', { variant: 'success' })
      } catch (error) {
        console.error('business profile save failed', error)
        enqueueSnackbar('The business profile was not saved. Try again.', { variant: 'error' })
      } finally {
        dequeueLoading()
      }
    },
    [enqueueSnackbar, fromCache, profileRef, queueLoading, status, stored, user?.uid],
  )

  return (
    <FormRenderer
      FormTemplate={CardDisplayFormTemplate}
      componentMapper={simpleComponentMapper}
      onSubmit={handleSave}
      schema={schema}
      subscription={{ values: true }}
      initialValues={initialValues}
    />
  )
}
BusinessProfileCard.displayName = 'BusinessProfileCard'

export default BusinessProfileCard
