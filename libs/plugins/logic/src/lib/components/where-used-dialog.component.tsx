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

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material'
import type { WhereUsedResult } from '../utils/fetch-where-used'

/**
 * Besigner deep-links for a scanned screen/layout version. The routes live
 * in the console app's table; the patterns are stable, so the plugin builds
 * them directly rather than importing app-only route constants.
 */
const screenBesignerHref = (
  hostId: string,
  screenId: string,
  versionId: string,
) => `/${hostId}/screens/${screenId}/versions/${versionId}/besigner`
const layoutBesignerHref = (
  hostId: string,
  layoutId: string,
  versionId: string,
) => `/${hostId}/layouts/${layoutId}/versions/${versionId}/besigner`

export interface WhereUsedDialogProps {
  hostId: string
  usage: { name: string; result: WhereUsedResult } | null
  onClose: () => void
}

/**
 * Shared dependents dialog (AGL-187/193): where a variable, function, or
 * workflow is referenced — screen/layout rows deep-link into the besigner
 * of the scanned published version; legacy-token references are flagged
 * since renames break them.
 */
export function WhereUsedDialog(props: WhereUsedDialogProps) {
  const { hostId, usage, onClose } = props
  return (
    <Dialog open={Boolean(usage)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{`Where "${usage?.name}" is used`}</DialogTitle>
      <DialogContent>
        {usage?.result.total === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Not referenced by any published screen, layout, or workflow. ' +
              'Unpublished drafts are not scanned.'}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {usage?.result.dependents.map((dependent) => {
              const href =
                dependent.versionId && dependent.type === 'screen'
                  ? screenBesignerHref(hostId, dependent.id, dependent.versionId)
                  : dependent.versionId && dependent.type === 'layout'
                    ? layoutBesignerHref(hostId, dependent.id, dependent.versionId)
                    : null
              return (
                <Stack
                  key={`${dependent.type}-${dependent.id}`}
                  direction="row"
                  spacing={1}
                  sx={{ justifyContent: 'space-between' }}
                >
                  {href ? (
                    <MuiLink href={href} variant="body2" noWrap>
                      {dependent.name}
                    </MuiLink>
                  ) : (
                    <Typography variant="body2" noWrap>
                      {dependent.name}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {dependent.type +
                      (dependent.via.includes('name') ? ' · legacy token' : '')}
                  </Typography>
                </Stack>
              )
            })}
            {usage?.result.legacyCount ? (
              <Typography variant="caption" color="warning.main">
                {'Legacy tokens reference this by name and break if it is ' +
                  'renamed — re-publish those screens to upgrade them.'}
              </Typography>
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}
WhereUsedDialog.displayName = 'WhereUsedDialog'

export default WhereUsedDialog
