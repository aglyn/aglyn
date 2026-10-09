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

/*
 * THE EMAILS AND CAMPAIGNS LISTS, AS VALUES, FOR THE NATIVE APPS (AGL-3669).
 *
 * The console picks its list declarations through functions of the hub's
 * level; the native contracts generator reads exports, so each site-level
 * declaration is re-exported here as the value it is. Nothing in the web
 * apps imports this file, so it adds nothing to their bundles.
 */

import type { ListQueryDeclaration } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  CAMPAIGN_SEND_STATUS_OPTIONS,
  campaignContainersListQuery,
  campaignEmailsListQuery,
} from './campaign-list-query'

/** A site's Emails list: every send under the site, newest first. */
export const NATIVE_SITE_EMAILS_QUERY: ListQueryDeclaration = campaignEmailsListQuery(false)

/** A site's Campaigns list: the containers the site's scope sees. */
export const NATIVE_SITE_CAMPAIGNS_QUERY: ListQueryDeclaration = campaignContainersListQuery(false)

/** The stored statuses a send can hold, for the Status chips. */
export const NATIVE_CAMPAIGN_SEND_STATUSES: { value: string; label: string }[] = CAMPAIGN_SEND_STATUS_OPTIONS.map(
  (option) => ({ value: option.value, label: option.label }),
)
