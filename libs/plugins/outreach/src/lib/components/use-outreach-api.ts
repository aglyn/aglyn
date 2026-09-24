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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useMemo } from 'react'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'
import type { OutreachComplianceIssue } from '../model/compliance-settings'
import type {
  OutreachDoNotContactDomainRequest,
  OutreachDoNotContactDomainResponse,
  OutreachDoNotContactDomainsResponse,
  OutreachEnrollmentAction,
  OutreachEnrollmentActionResponse,
  OutreachEnrollPersonRequest,
  OutreachEnrollPreviewResponse,
  OutreachEnrollResponse,
  OutreachEnrollSource,
  OutreachLinkDomainRequest,
  OutreachLinkDomainResponse,
  OutreachLinkDomainsResponse,
  OutreachPreviewRequest,
  OutreachPreviewResponse,
  OutreachRouteRefusal,
  OutreachRouteRefusalReason,
  OutreachSequenceAction,
  OutreachSequenceSaveResponse,
  OutreachSequenceStatusResponse,
  OutreachSettingsResponse,
  OutreachSettingsSaveRequest,
  OutreachSettingsSaveResponse,
} from '../model/outreach-api'
import type {
  OutreachSequenceDraft,
  OutreachSequenceIssue,
} from '../model/sequence-draft'

/**
 * A route's refusal, carrying its sentence, its stable reason and any
 * field-level issues. `refused` is the one a page shows as "you can't use
 * this here" rather than as something that went wrong: no permission, no
 * entitlement, or the release gate answering as if the route did not exist.
 */
export class OutreachRouteError extends Error {
  readonly reason: OutreachRouteRefusalReason | 'unreachable' | 'not-found'
  readonly status: number
  readonly issues: ReadonlyArray<
    OutreachComplianceIssue | OutreachSequenceIssue
  >

  constructor(
    message: string,
    reason: OutreachRouteError['reason'],
    status: number,
    issues: OutreachRouteError['issues'] = [],
  ) {
    super(message)
    this.name = 'OutreachRouteError'
    this.reason = reason
    this.status = status
    this.issues = issues
  }

  get refused(): boolean {
    return (
      this.reason === 'permission' ||
      this.reason === 'entitlement' ||
      this.reason === 'not-org-wide' ||
      this.reason === 'not-a-member' ||
      // The dispatcher answers a route whose plugin is not released to this
      // workspace as though it did not exist.
      this.reason === 'not-found'
    )
  }
}

/** The routes, as the Outreach pages call them. */
export interface OutreachApi {
  readSettings(): Promise<OutreachSettingsResponse>
  saveSettings(
    input: Omit<OutreachSettingsSaveRequest, 'orgId'>,
  ): Promise<OutreachSettingsSaveResponse>
  saveSequence(
    sequenceId: string | null,
    sequence: OutreachSequenceDraft,
  ): Promise<OutreachSequenceSaveResponse>
  setSequenceStatus(
    sequenceId: string,
    action: OutreachSequenceAction,
  ): Promise<OutreachSequenceStatusResponse>
  deleteSequence(sequenceId: string): Promise<{ ok: true }>
  previewEnrollment(
    sequenceId: string,
    source: OutreachEnrollSource,
  ): Promise<OutreachEnrollPreviewResponse>
  enroll(
    sequenceId: string,
    people: OutreachEnrollPersonRequest[],
  ): Promise<OutreachEnrollResponse>
  actOnEnrollment(
    enrollmentId: string,
    action: OutreachEnrollmentAction,
    detail?: string,
  ): Promise<OutreachEnrollmentActionResponse>
  previewEmail(
    input: Omit<OutreachPreviewRequest, 'orgId'>,
  ): Promise<OutreachPreviewResponse>
  /** The domains on the do-not-contact list (AGL-3244). */
  readDoNotContactDomains(): Promise<OutreachDoNotContactDomainsResponse>
  /** Puts a domain on the list, or takes one off. */
  changeDoNotContactDomain(
    action: OutreachDoNotContactDomainRequest['action'],
    domain: string,
    detail?: string,
  ): Promise<OutreachDoNotContactDomainResponse>
  /** Each mailbox domain's click-tracking host (AGL-3306). */
  readLinkDomains(): Promise<OutreachLinkDomainsResponse>
  /** Sets a link domain up, checks it, or removes it. */
  changeLinkDomain(
    action: OutreachLinkDomainRequest['action'],
    domain: string,
  ): Promise<OutreachLinkDomainResponse>
}

/**
 * The Outreach pages' one door to the settings, sequence and enrollment
 * routes (AGL-2980), with the member's session attached and the
 * organization named on every call. A refusal is thrown as an
 * {@link OutreachRouteError} carrying the route's own sentence, which is
 * written for the person reading it.
 */
export function useOutreachApi(orgId: string | null): OutreachApi {
  const { data: user } = useUser()

  const call = useCallback(
    async <T>(
      route: string,
      init: { method: 'GET' | 'POST'; body?: Record<string, unknown> },
    ): Promise<T> => {
      if (!orgId)
        throw new OutreachRouteError(
          'Open an organization first.',
          'org-required',
          400,
        )
      const path =
        init.method === 'GET'
          ? `/api/${route}?orgId=${encodeURIComponent(orgId)}`
          : `/api/${route}`
      let response: Response
      try {
        response = await authorizedFetch(user, path, {
          method: init.method,
          ...(init.method === 'POST'
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orgId, ...init.body }),
              }
            : {}),
        })
      } catch {
        throw new OutreachRouteError(
          'Sequences could not be reached. Try again.',
          'unreachable',
          0,
        )
      }
      const payload = (await response.json().catch(() => null)) as
        (T & { error?: undefined }) | Partial<OutreachRouteRefusal> | null
      if (!response.ok || !payload) {
        const refusal = (payload ?? {}) as Partial<OutreachRouteRefusal>
        throw new OutreachRouteError(
          refusal.error && refusal.reason
            ? refusal.error
            : response.status === 404
              ? "Sequences isn't available to this workspace yet."
              : 'Sequences could not be reached. Try again.',
          refusal.reason ??
            (response.status === 404 ? 'not-found' : 'unreachable'),
          response.status,
          refusal.issues ?? [],
        )
      }
      return payload as T
    },
    [user, orgId],
  )

  return useMemo<OutreachApi>(
    () => ({
      readSettings: () => call(OUTREACH_API_ROUTES.settings, { method: 'GET' }),
      saveSettings: (input) =>
        call(OUTREACH_API_ROUTES.settings, {
          method: 'POST',
          body: { ...input },
        }),
      saveSequence: (sequenceId, sequence) =>
        call(OUTREACH_API_ROUTES.sequencesSave, {
          method: 'POST',
          body: { ...(sequenceId ? { sequenceId } : {}), sequence },
        }),
      setSequenceStatus: (sequenceId, action) =>
        call(OUTREACH_API_ROUTES.sequencesStatus, {
          method: 'POST',
          body: { sequenceId, action },
        }),
      deleteSequence: (sequenceId) =>
        call(OUTREACH_API_ROUTES.sequencesDelete, {
          method: 'POST',
          body: { sequenceId },
        }),
      previewEnrollment: (sequenceId, source) =>
        call(OUTREACH_API_ROUTES.enrollPreview, {
          method: 'POST',
          body: { sequenceId, source },
        }),
      enroll: (sequenceId, people) =>
        call(OUTREACH_API_ROUTES.enroll, {
          method: 'POST',
          body: { sequenceId, people },
        }),
      actOnEnrollment: (enrollmentId, action, detail) =>
        call(OUTREACH_API_ROUTES.enrollmentsAction, {
          method: 'POST',
          body: { enrollmentId, action, ...(detail ? { detail } : {}) },
        }),
      previewEmail: (input) =>
        call(OUTREACH_API_ROUTES.preview, {
          method: 'POST',
          body: { ...input },
        }),
      readDoNotContactDomains: () =>
        call(OUTREACH_API_ROUTES.doNotContactDomains, { method: 'GET' }),
      changeDoNotContactDomain: (action, domain, detail) =>
        call(OUTREACH_API_ROUTES.doNotContactDomains, {
          method: 'POST',
          body: { action, domain, ...(detail ? { detail } : {}) },
        }),
      readLinkDomains: () => call(OUTREACH_API_ROUTES.linkDomains, { method: 'GET' }),
      changeLinkDomain: (action, domain) =>
        call(OUTREACH_API_ROUTES.linkDomains, {
          method: 'POST',
          body: { action, domain },
        }),
    }),
    [call],
  )
}
