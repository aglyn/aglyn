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
  registerPluginRecordRoute,
  type PluginRecordRouteContext,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * Where a form submission is read, published for every other surface
 * (AGL-3080).
 *
 * A contact's timeline opens the submission that captured the person. It asks
 * the record-route registry for `formSubmission` rather than spelling this
 * plugin's console path, and gets `null` (text instead of a link) where this
 * plugin is not loaded.
 *
 * A submission has no page of its own: it opens in the reader over the
 * Submissions section, which reads {@link INBOX_SUBMISSION_PARAM} on arrival.
 * The section is at both levels; opening one submission needs the site whose
 * form took it, so only a site addresses a record.
 */

/** The nav slug the shell resolves the Inbox by, at either level. */
const INBOX_SLUG = 'inbox'

/** The query key the Submissions section opens one submission's reader by. */
export const INBOX_SUBMISSION_PARAM = 'submission'

function submissions({ orgSlug, host }: PluginRecordRouteContext): string {
  const hub = host
    ? buildRoute(Route.HOST_PLUGIN, { orgSlug, host, pluginSlug: INBOX_SLUG })
    : buildRoute(Route.ORG_PLUGIN, { orgSlug, pluginSlug: INBOX_SLUG })
  return `${hub}/submissions`
}

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the route registers the same way under a spec that
 * calls the registrar directly.
 */
export function registerInboxRecordRoutes(): void {
  registerPluginRecordRoute(
    'formSubmission',
    {
      list: submissions,
      record: (context, id) =>
        context.host
          ? `${submissions(context)}?${new URLSearchParams({ [INBOX_SUBMISSION_PARAM]: id }).toString()}`
          : null,
    },
    { pluginId: BUNDLE_ID },
  )
}
