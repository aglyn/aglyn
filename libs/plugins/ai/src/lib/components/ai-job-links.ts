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
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import {
  pluginRecordHref,
  pluginRecordListHref,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { AI_JOB_BESIGNER_SEGMENT as BESIGNER_SEGMENT } from '../model/ai-job-notice'
import type { AiJobOutput, AiJobSummary } from '../model/ai-jobs.types'

// Where a job's work opens in the console (AGL-2904), shared by the AI jobs
// drawer and every dialog that follows the job it started (AGL-3593).

/**
 * Where "open draft" goes, or `null` when the output has no page of its
 * own — a `text` output carries its copy on the job and is shown inline.
 * A versioned resource opens in the besigner on the version the job wrote;
 * one the console lists without a detail page opens its list; a `theme`
 * proposal opens the site's Theme section, where it is put in the editor.
 *
 * A console URL names a site by its SUBDOMAIN: the `[host]` segment resolves
 * through the member's host projection by subdomain, never by document id.
 * So an output that carries no `hostSubdomain` gets no link rather than one
 * that opens no site.
 */
export function aiJobOutputHref(output: AiJobOutput, orgSlug: string): string | null {
  const host = output.hostSubdomain
  if (!orgSlug || !host) return null
  const segment = BESIGNER_SEGMENT[output.resource]
  if (segment) {
    const base = `/${orgSlug}/hosts/${host}/${segment}/${output.id}`
    return output.versionId ? `${base}/versions/${output.versionId}/besigner` : base
  }
  if (output.resource === 'product') {
    // The catalog a drafted product lands in: the commerce plugin's address
    // for it (AGL-3080), or no link where commerce is not loaded.
    return pluginRecordListHref('product', { orgSlug, host })
  }
  if (output.resource === 'workflow') {
    // A drafted automation is an action (AGL-2919), listed switched off on
    // the workflows plugin's list of actions, or no link where it is not loaded.
    return pluginRecordListHref('action', { orgSlug, host })
  }
  if (output.resource === 'theme') {
    return buildRoute(Route.HOST_SETUP_THEME, { orgSlug, host })
  }
  if (output.resource === 'form') {
    // A new form has no version for the besigner to open: its own page — the
    // forms plugin's address for it — mints the first one, and holds the
    // routing and consent it declares.
    return pluginRecordHref('form', { orgSlug, host }, output.id)
  }
  if (output.resource === 'campaign') {
    // A campaign's page is the marketing plugin's, under the site: its
    // address for the campaign (AGL-3080), or no link where it is not loaded.
    return pluginRecordHref('campaign', { orgSlug, host }, output.id)
  }
  return null
}

/**
 * The ONE action a finished job's row, its notification and the dialog that
 * started it lead with (AGL-3593): what the job built. Several pages from one
 * job — a site's — open the site's Pages list, where they wait as drafts; one
 * output with a page of its own opens that page; anything else has no single
 * place to go, and the row's own links stand. `null` until the job is done.
 */
export function aiJobPrimaryLink(
  job: Pick<AiJobSummary, 'status' | 'outputs'>,
  orgSlug: string,
): { href: string; label: string } | null {
  if (job.status !== 'done' || !orgSlug) return null
  const screens = job.outputs.filter(
    (output) => output.resource === 'screen' && output.hostSubdomain,
  )
  if (screens.length > 1) {
    return {
      href: buildRoute(Route.HOST_SCREENS, { orgSlug, host: String(screens[0].hostSubdomain) }),
      label: 'Open your draft pages',
    }
  }
  for (const output of job.outputs) {
    const href = aiJobOutputHref(output, orgSlug)
    if (href) {
      return {
        href,
        label: output.resource === 'screen' ? 'Open the draft page' : `Open ${output.label}`,
      }
    }
  }
  return null
}
