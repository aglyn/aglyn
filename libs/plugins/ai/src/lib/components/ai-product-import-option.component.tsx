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

import type { ConsoleProductImportZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { Checkbox, FormControlLabel, Stack, Typography } from '@mui/material'
import { AI_PRODUCTS_BULK_MAX, AI_PRODUCTS_IMPORT_WRITE_COPY } from '../model/ai-products'
import { useAiProductsJobs } from './use-ai-products-jobs'

/**
 * "Write copy with AI as they land" in the commerce CSV import dialog
 * (AGL-2916), through the `productImport` zone. The box sets an option on the
 * import; once the import has created its products, the products hub's AI
 * card starts one copy job for them, and its proposals wait there for review
 * like any other. Nothing is written to an imported product until a person
 * applies its copy.
 */
export function AiProductImportOption(props: ConsoleProductImportZoneProps) {
  const { hostId, count, options, setOption } = props
  const { verdict } = useAiProductsJobs({ hostId, orgId: props.orgId })
  if (verdict !== 'ready') return null
  const covered = Math.min(count, AI_PRODUCTS_BULK_MAX)
  return (
    <Stack spacing={0.25}>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={Boolean(options[AI_PRODUCTS_IMPORT_WRITE_COPY])}
            onChange={(event) => setOption(AI_PRODUCTS_IMPORT_WRITE_COPY, event.target.checked)}
          />
        }
        label="Write descriptions, search listings and tags with AI as they land"
      />
      <Typography variant="caption" color="text.secondary">
        {(count > AI_PRODUCTS_BULK_MAX
          ? `Copy is written for the first ${covered} of the ${count} products. `
          : '') + 'You review it on the products page before any is saved. Prices are never written.'}
      </Typography>
    </Stack>
  )
}
AiProductImportOption.displayName = 'AiProductImportOption'

export default AiProductImportOption
