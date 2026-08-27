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
import { Button, Stack } from '@mui/material'
import EmptyState from './empty-state.component'
import { CONTENT_MAX_WIDTH } from '../constants/shared'
import { buildRoute, Route } from '../constants/route-links'
import { useUrlNamedOrg } from '../hooks/use-url-names-org'

/**
 * The console's designed not-found body (AGL-625). Rendered inside the main
 * chrome so a mistyped path, a retired `/[hostId]` bookmark from before the
 * org-slug routing move (AGL-621), or an org the signed-in user can't reach
 * lands on a friendly page — never a bare 404 or a sign-out. The only always-
 * safe destination is the org jump page at `/`, which re-picks a workspace.
 */
export function NotFoundContent() {
  /**
   * The workspace the URL names, when the signed-in user can actually open it
   * (AGL-2486).
   *
   * The single description below blamed three unrelated things at once — a
   * stale link, a workspace you can't open, a site you can't open — and on the
   * commonest 404 of all it blamed the wrong one.
   * `/aglyn-org/hosts/aglyn-marketing/screens/pegb_4s5wV` names a workspace the
   * reader owns and a site that exists; the only thing wrong with it is that
   * `/screens/[screenId]` is not a route (the editor lives at
   * `…/screens/[screenId]/versions/[versionId]/…`). Saying the workspace might
   * not be theirs sends them hunting for a permissions problem that is not
   * there.
   *
   * Resolving to a membership is exactly the distinction worth drawing, and it
   * is now cheap: a hit means the URL's workspace is real AND reachable, so
   * the address is the only suspect. A miss stays deliberately vague, because
   * a miss genuinely does conflate "no such workspace", "not yours" and "not
   * read yet" — and the honest move there is the wording that already covers
   * all three rather than a guess that reads as a verdict.
   */
  const namedOrg = useUrlNamedOrg()
  const orgName = namedOrg?.orgName ?? namedOrg?.slug

  return (
    <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
      <EmptyState
        // Not a list at all: the caller has already decided this route is
        // not-found, so there is no read behind this whose success is in
        // question (AGL-1066).
        read="loaded"
        iconPath={ICON_VARIANT_SEARCH.path}
        title={'This page isn’t here'}
        description={
          namedOrg
            ? `That address isn’t a page in ${orgName}. The link may be out ` +
              'of date, or a page that has since moved or been deleted.'
            : 'The link may be out of date, or the workspace or site it ' +
              'points to isn’t one you can open. Pick a workspace to get ' +
              'back on track.'
        }
        action={
          <Stack direction="row" spacing={1.5}>
            {/* When the workspace IS openable, the useful way out is back
                into it — the workspaces list is a detour through a choice the
                URL already made correctly. */}
            {namedOrg?.slug ? (
              <Button
                variant="contained"
                color="primary"
                component={AppLink as any}
                {...({ componentVariant: 'naked', nativeButton: false } as any)}
                href={buildRoute(Route.HOST_LIST, { orgSlug: namedOrg.slug })}
              >
                {`Back to ${orgName}`}
              </Button>
            ) : null}
            <Button
              variant={namedOrg ? 'outlined' : 'contained'}
              color="primary"
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
