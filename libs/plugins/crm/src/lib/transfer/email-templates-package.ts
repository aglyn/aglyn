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

/*==========================================
 * EMAIL TEMPLATES AS PACKAGE ITEMS (AGL-3535).
 *
 * An item is a template as a person reads it: its name, kind, visibility,
 * subject and body, and the site it was written under (`hostId`, `null`
 * for the organization's own). Never who wrote it or when, so a template
 * exported and imported back is `identical`. A personal template travels
 * as personal and lands as the importer's own — a colleague's personal
 * templates are theirs, and are neither exported nor matched.
 *
 * What it names: its site, if any. A dropped site makes it the
 * organization's own.
 *
 * Pure: the server half (`email-templates-package.server.ts`) reads and
 * writes.
 *=========================================*/

import {
  CRM_EMAIL_TEMPLATE_NAME_MAX,
  normalizeCrmEmailTemplate,
  type CrmEmailTemplateKind,
  type CrmEmailTemplateVisibility,
} from '@aglyn/aglyn/app-utils/crm-email-templates'
import type { PackageDependency } from '@aglyn/aglyn/data-transfer/package'
import { remapPackageReference, TRANSFER_SITE_KIND } from '@aglyn/aglyn/data-transfer/package-plan'

/** The resource key, and so the kind every template item carries. */
export const CRM_EMAIL_TEMPLATES_TRANSFER_KEY = 'crm.email-templates'

/** A template as a package carries it. */
export interface CrmEmailTemplatePackageContent {
  name: string
  kind: CrmEmailTemplateKind
  visibility: CrmEmailTemplateVisibility
  subject: string
  body: string
  hostId: string | null
}

/** The package content of a stored template, or of an incoming item, held to the template's own shape. */
export function crmEmailTemplatePackageContent(source: unknown): CrmEmailTemplatePackageContent {
  const template = normalizeCrmEmailTemplate((source && typeof source === 'object' ? source : {}) as Record<string, unknown>)
  return {
    name: template.name,
    kind: template.kind,
    visibility: template.visibility,
    subject: template.kind === 'snippet' ? '' : template.subject,
    body: template.body,
    hostId: template.hostId,
  }
}

export function crmEmailTemplateDependencies(content: CrmEmailTemplatePackageContent): PackageDependency[] {
  return content.hostId ? [{ kind: TRANSFER_SITE_KIND, id: content.hostId }] : []
}

export function remapCrmEmailTemplateIds(
  content: CrmEmailTemplatePackageContent,
  idMap: ReadonlyMap<string, string>,
): CrmEmailTemplatePackageContent {
  return { ...content, hostId: remapPackageReference(idMap, TRANSFER_SITE_KIND, content.hostId) }
}

/** What a template must be before it is stored, each a sentence. */
export function crmEmailTemplatePackageProblems(content: CrmEmailTemplatePackageContent): string[] {
  const problems: string[] = []
  if (!content.name.trim()) problems.push('Name the template.')
  if (content.name.length > CRM_EMAIL_TEMPLATE_NAME_MAX) {
    problems.push(`Keep the name under ${CRM_EMAIL_TEMPLATE_NAME_MAX} characters.`)
  }
  if (!content.body.trim()) problems.push('A template needs its text.')
  return problems
}

export const CRM_EMAIL_TEMPLATE_PACKAGE_RULES = [
  {
    id: 'personal',
    label: 'A personal template becomes yours',
    reason: 'A personal template is listed for one person. One you import is filed as your own, and a colleague’s personal templates are never exported.',
  },
] as const
