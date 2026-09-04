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

import { mdiBugOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import ReportIssueDialog from '../../../../components/report-issue-dialog.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

/**
 * A URL for the defect channel (AGL-2486).
 *
 * The dialog itself is unchanged and still lives on the account menu, where
 * somebody already inside the console reaches it in one click. What did not
 * exist was a LINK: nothing outside the console could send a person to it, so
 * the repo's README pointed at GitHub issues — a tracker we do not read — and
 * every other "tell us about it" surface had the same problem.
 *
 * A route rather than a query parameter on the console root. The root is the
 * workspace jump page and a single-workspace member is forwarded off it
 * immediately, which drops a parameter and lands them somewhere they did not
 * ask to be. A path survives the sign-in redirect, is bookmarkable, and says
 * what it is in the address bar.
 *
 * Under `manage/` because the dialog is user-level in exactly the way the
 * rest of that section is: no workspace, no role, no plan. It renders in the
 * authenticated shell, so an unauthenticated visitor is sent to sign-in and
 * returned here, and an unverified address is asked to verify — both of which
 * this page inherits rather than restates.
 */
const ReportIssuePage: NextPageWithLayout<Record<string, never>> = () => {
  // Open on arrival: this URL means "file a report", so making the visitor
  // click a button first would be a step that answers nothing.
  const [open, setOpen] = useState(true)

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Report an issue',
          href: buildRoute(Route.MANAGE_REPORT_ISSUE),
        },
      ]}
      header={{
        children: 'Report an issue',
        icon: { path: mdiBugOutline.path },
      }}
      help={{ topic: 'reportAnIssue' }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <CardDisplay
          header={'Something broken, or missing?'}
          help={docsHelp('reportAnIssue')}
        >
          {/* The page behind the dialog is not a placeholder: closing the
              dialog has to leave something that explains where you are and
              lets you open it again, rather than a blank console page. */}
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="body2" color="text.secondary">
              {'Tell us what happened and we will track it. The report ' +
                'carries the page you were on, your workspace and plan, and ' +
                'the build you were running — there is nothing to describe ' +
                'about your setup. You can also open this from the account ' +
                'menu on any console page.'}
            </Typography>
            <Button variant="contained" onClick={() => setOpen(true)}>
              {'Report an issue'}
            </Button>
          </Stack>
        </CardDisplay>
      </Container>
      <ReportIssueDialog open={open} onClose={() => setOpen(false)} />
    </DashboardLayout>
  )
}
ReportIssuePage.displayName = 'Page:ReportIssue'

export default ReportIssuePage
