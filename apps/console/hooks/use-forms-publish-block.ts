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

// By their own modules rather than the barrel: every besigner page calls this
// hook, and the specs that render one replace `@aglyn/aglyn` with a closed
// world, where a name the hook added would arrive as `undefined` from inside
// render. These modules are small and nothing replaces them.
import { useEnabledPlugins } from '@aglyn/aglyn/app-utils/enabled-plugins-context'
import { formsOffPublishViolation } from '@aglyn/aglyn/app-utils/form-contract'
import { FORMS_PLUGIN_ID } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback } from 'react'

export interface FormsPublishBlock {
  /**
   * Whether Forms runs on the site being edited: `undefined` where no site
   * set was published to the editor, which refuses nothing.
   */
  formsOnForSite: boolean | undefined
  /**
   * Refuse a publish of this node map when it carries a form on a site that
   * switched Forms off, saying why. `true` when it refused.
   */
  refuse: (nodes: unknown) => boolean
}

/**
 * The publish-time Forms check a besigner runs before it puts a page, layout
 * or component live (AGL-3029).
 *
 * On a site that switched Forms off the published page draws no form and
 * `/api/forms/submit` refuses every submission, so a publish that carried one
 * would put an empty space on a live page while the author believed they had
 * shipped a form. The site's plugin set is the one `withSitePlugins` publishes
 * to every editor route, so this asks the same answer the tenant renders from.
 *
 * A courtesy in front of a boundary, not the boundary: what keeps a visitor
 * from a form on a switched-off site is the render and the submit route.
 */
export function useFormsPublishBlock(): FormsPublishBlock {
  const enabled = useEnabledPlugins()
  const { enqueueSnackbar } = useSnackbar()
  const formsOnForSite = enabled ? enabled.includes(FORMS_PLUGIN_ID) : undefined
  const refuse = useCallback(
    (nodes: unknown) => {
      const violation = formsOffPublishViolation(nodes as never, formsOnForSite)
      if (!violation) return false
      // `persist`: a refusal the author must act on, not a passing notice.
      enqueueSnackbar(violation.message, {
        variant: 'warning',
        allowDuplicate: true,
        persist: true,
      })
      return true
    },
    [enqueueSnackbar, formsOnForSite],
  )
  return { formsOnForSite, refuse }
}

export default useFormsPublishBlock
