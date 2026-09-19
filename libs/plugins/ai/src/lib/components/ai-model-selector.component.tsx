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

import { Button, ListItemText, Menu, MenuItem } from '@mui/material'
import { useState, type MouseEvent } from 'react'
import type { AiModelChoiceState } from './use-ai-model-choice'

export interface AiModelSelectorProps {
  choice: AiModelChoiceState
  disabled?: boolean
}

const perRequest = (credits: number): string =>
  `≈ ${credits.toLocaleString()} credit${credits === 1 ? '' : 's'} a request`

/**
 * THE MODEL SWITCH (AGL-2942): Auto, and the models the reader's plan, the
 * workspace's restriction and their allotment allow — each with what a
 * typical request costs on it and the multiple of Auto.
 *
 * Every label and id comes from the provider catalog through the options
 * route; this component names no model. The pick is remembered per person
 * per surface (`use-ai-model-choice.ts`), and the door the request goes to
 * decides again, so a stale pick runs on Auto rather than on a model the
 * reader may no longer have.
 */
export function AiModelSelector({ choice, disabled }: AiModelSelectorProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = (event: MouseEvent<HTMLElement>) => {
    setAnchor(event.currentTarget)
    choice.load()
  }
  const close = () => setAnchor(null)
  const pick = (option: { id: string; label: string } | null) => {
    choice.select(option)
    close()
  }
  const { options, status } = choice
  return (
    <>
      <Button
        size="small"
        color="inherit"
        onClick={open}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={`AI model: ${choice.label}`}
        sx={{ textTransform: 'none', minWidth: 0, px: 1, color: 'text.secondary' }}
      >
        {`Model: ${choice.label}`}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        {status === 'loading' || status === 'idle' ? (
          <MenuItem disabled>{'Loading models…'}</MenuItem>
        ) : null}
        {status === 'refused' ? (
          <MenuItem disabled>{'Your role does not include AI assistance'}</MenuItem>
        ) : null}
        {status === 'error' ? (
          <MenuItem disabled>{'The models could not be loaded — try again'}</MenuItem>
        ) : null}
        {status === 'ready' && options?.auto ? (
          <MenuItem selected={choice.model === null} onClick={() => pick(null)}>
            <ListItemText
              primary={options.auto.label}
              secondary={`${perRequest(options.auto.creditsPerRequest)} · picked for each request`}
            />
          </MenuItem>
        ) : null}
        {status === 'ready' && options
          ? options.options.map((option) => (
              <MenuItem
                key={option.id}
                selected={choice.model === option.id}
                onClick={() => pick({ id: option.id, label: option.label })}
              >
                <ListItemText
                  primary={option.label}
                  secondary={`${perRequest(option.creditsPerRequest)} · ${option.multiplier}× Auto`}
                />
              </MenuItem>
            ))
          : null}
        {status === 'ready' && options && !options.options.length ? (
          <MenuItem disabled>{'This workspace runs on Auto'}</MenuItem>
        ) : null}
      </Menu>
    </>
  )
}
AiModelSelector.displayName = 'AiModelSelector'

export default AiModelSelector
