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

import * as Aglyn from '@aglyn/aglyn'
import { HelpTip } from '@aglyn/shared-ui-jsx'
import {
  Button,
  FormControl,
  IconButton,
  MenuItem as MuiMenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { useContext } from 'react'
import {
  InteractionsContext,
  nodeElementSelector,
  type InteractionTriggerEvent,
} from '../contexts/interactions-context'
import { besignerDocsUrl } from '../utils/docs-help'

export interface ElementInteractionsFormProps {
  node: Aglyn.NodeSchema<any>
}

/**
 * Interactions on the selected element, as its own panel tab (AGL-1486).
 *
 * They used to sit at the bottom of Attributes, under every field the
 * component declares — so on anything with more than a handful of attributes
 * they were below the fold, and an author had no reason to believe the
 * element had any. An interaction is not an attribute: it is a behaviour, it
 * is authored in a dialog rather than a field, and it now lives with the
 * canvas states and styles as a peer.
 *
 * The list, the trigger picker and the section experiment move verbatim; what
 * changes is where they are.
 */
export const ElementInteractionsForm = observer(
  (props: ElementInteractionsFormProps) => {
    const { node } = props
    const interactions = useContext(InteractionsContext)
    const nodeSelector = node?.$id ? nodeElementSelector(node.$id) : ''
    const nodeAutomations = (interactions.automations ?? []).filter(
      (automation) => automation.selector === nodeSelector,
    )
    const nodeExperiment = (interactions.sectionExperiments ?? []).find(
      (experiment) => experiment.nodeId === node?.$id,
    )
    if (!interactions.onCreateInteraction || !node?.$id) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          {'Interactions are not available on this kind of document.'}
        </Typography>
      )
    }
    return (
      <Stack sx={{ p: 2 }}>
        <FormControl margin="none" fullWidth>
          {/* Interactions (AGL-258): automations bound to this
              element's stable data-aglyn selector. */}
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ mt: 2 }}
          >
            {'Interactions'}
            {/* AGL-2167 — the trigger list says when, and
                nothing here says what an interaction can then
                do, or that the target is picked by clicking. */}
            <HelpTip
              title="Interactions"
              excerpt="Run an action when this element is clicked, hovered, or scrolled into view. Targets are picked by clicking them on the canvas."
              href={besignerDocsUrl('interactions', '#fluent-interactions')}
              sx={{ ml: 0.25, fontSize: '0.9em' }}
            />
          </Typography>
          {nodeAutomations.map((automation) => (
            <Stack
              key={automation.id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', mb: 0.5 }}
            >
              <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                {automation.name ?? automation.id}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {automation.event}
              </Typography>
              {/* Manage in place (wave v7): toggle + remove
                  without leaving the canvas. */}
              {interactions.onToggleInteraction ? (
                <Switch
                  size="small"
                  checked={automation.enabled !== false}
                  onChange={(event) =>
                    interactions.onToggleInteraction?.({
                      id: automation.id,
                      enabled: event.target.checked,
                    })
                  }
                  slotProps={{
                    input: { 'aria-label': 'Interaction enabled' },
                  }}
                />
              ) : automation.enabled === false ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  {'off'}
                </Typography>
              ) : null}
              {/* Fluent builder (AGL-319): edit reopens the
                  inline dialog — no Workflows detour. */}
              {interactions.onEditInteraction && node?.$id ? (
                <IconButton
                  size="small"
                  aria-label="Edit interaction"
                  onClick={() =>
                    interactions.onEditInteraction?.({
                      id: automation.id,
                      nodeId: node.$id as string,
                    })
                  }
                >
                  {'✎'}
                </IconButton>
              ) : null}
              {interactions.onDeleteInteraction ? (
                <IconButton
                  size="small"
                  aria-label="Remove interaction"
                  onClick={() =>
                    interactions.onDeleteInteraction?.({
                      id: automation.id,
                    })
                  }
                >
                  {'✕'}
                </IconButton>
              ) : null}
            </Stack>
          ))}
          <TextField
            select
            size="small"
            label="Add interaction"
            value=""
            onChange={(event) => {
              const trigger = event.target
                .value as InteractionTriggerEvent
              if (trigger && node?.$id) {
                interactions.onCreateInteraction?.({
                  nodeId: node.$id,
                  event: trigger,
                })
              }
            }}
          >
            <MuiMenuItem value="elementClick">
              {'When clicked…'}
            </MuiMenuItem>
            {/* Hover choreography (AGL-562). */}
            <MuiMenuItem value="elementHoverEnter">
              {'When hovered…'}
            </MuiMenuItem>
            <MuiMenuItem value="elementHoverLeave">
              {'When hover ends…'}
            </MuiMenuItem>
            <MuiMenuItem value="elementVisible">
              {'When scrolled into view…'}
            </MuiMenuItem>
          </TextField>
          {interactions.onCreateSectionExperiment ? (
            nodeExperiment ? (
              <Typography
                variant="caption"
                color="primary"
                sx={{ mt: 1 }}
              >
                {`A/B test: ${nodeExperiment.name ?? nodeExperiment.id}` +
                  ` (${nodeExperiment.status ?? 'draft'})`}
              </Typography>
            ) : (
              <Button
                color="primary"
                size="small"
                sx={{ mt: 1, alignSelf: 'flex-start' }}
                onClick={() =>
                  node?.$id &&
                  interactions.onCreateSectionExperiment?.({
                    nodeId: node.$id,
                  })
                }
              >
                {'A/B test this section'}
              </Button>
            )
          ) : null}
        </FormControl>
      </Stack>
    )
  },
)
ElementInteractionsForm.displayName = 'ElementInteractionsForm'

export default ElementInteractionsForm
