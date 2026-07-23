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

import { ICON_VARIANT_SEARCH } from '@aglyn/shared-data-enums'
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { Button, Stack } from '@mui/material'
import EmptyState from './empty-state.component'
import { CONTENT_MAX_WIDTH } from '../constants/shared'

/**
 * The console's designed not-found body (AGL-625). Rendered inside the main
 * chrome so a mistyped path, a retired `/[hostId]` bookmark from before the
 * org-slug routing move (AGL-621), or an org the signed-in user can't reach
 * lands on a friendly page — never a bare 404 or a sign-out. The only always-
 * safe destination is the org jump page at `/`, which re-picks a workspace.
 */
export function NotFoundContent() {
  return (
    <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
      <NextPageTitle screen={'Not found'} />
      <EmptyState
        iconPath={ICON_VARIANT_SEARCH.path}
        title={'This page isn’t here'}
        description={
          'The link may be out of date, or the workspace or site it points to ' +
          'isn’t one you can open. Pick a workspace to get back on track.'
        }
        action={
          <Stack direction="row" spacing={1.5}>
            <Button
              variant="contained"
              color="secondary"
              component={AppLink as any}
              {...({ componentVariant: 'naked', nativeButton: false } as any)}
              href={'/'}
            >
              {'Go to my workspaces'}
            </Button>
          </Stack>
        }
      />
    </Container>
  )
}
NotFoundContent.displayName = 'NotFoundContent'

export default NotFoundContent
