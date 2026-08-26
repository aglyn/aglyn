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

import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { Box, type BoxProps, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * The console's empty state — one illustration, one sentence, one way out
 * (AGL-693).
 *
 * Lifted out of `data-table.component.tsx`, where it had been living as the
 * grid's no-rows overlay. Every list built on that grid — screens, layouts,
 * components, templates — has drawn this since AGL-601, and the media library
 * has drawn a bare line of grey text: *"No media here — upload images, video,
 * PDFs and documents to use on your site."* Same product, same moment, two
 * different answers, and the one with no illustration reads like a rendering
 * gap rather than an invitation.
 *
 * NOT in the `@aglyn/shared-ui-jsx` barrel, on purpose — subpath-import it
 * (`@aglyn/shared-ui-jsx/components/empty-state.component`). Nothing in the
 * tenant page graph shows an empty state, and the barrel rule at the top of
 * `src/index.ts` is enforced in CI.
 */

const classKeys = generateComponentClassKeys('EmptyStateComponent', [
  'label',
  'description',
  'action',
  'img1',
  'img2',
  'img3',
  'img4',
  'img5',
])

const EmptyStateRoot = styled(Box, { name: 'AglynEmptyState' })(
  ({ theme }) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: theme.spacing(3, 2),
    [`& .${classKeys.label}`]: {
      marginTop: theme.spacing(1),
    },
    [`& .${classKeys.description}`]: {
      marginTop: theme.spacing(0.5),
      maxWidth: 420,
    },
    [`& .${classKeys.action}`]: {
      marginTop: theme.spacing(2),
    },
    // The five fills the artwork is built from, taken off the theme's grey
    // ramp rather than written as hex (AGL-693). Still mode-aware — the flat
    // light greys disappear entirely against a dark surface — but the ramp is
    // what decides the tone now, so a host that retunes its greys retunes the
    // illustration with them instead of leaving it behind.
    //
    // The steps are chosen to keep the original stack's ORDER: img4 is the
    // paper the shape sits on, img2/img3 are its faces, img1 is the darkest
    // edge. Two of the originals carried a faint blue cast that the neutral
    // ramp does not; at this size, in a placeholder graphic, the depth
    // ordering is what reads, not the hue.
    [`& .${classKeys.img1}`]: {
      fill:
        theme.palette.mode === 'light'
          ? theme.palette.grey[400]
          : theme.palette.grey[900],
    },
    [`& .${classKeys.img2}`]: {
      fill:
        theme.palette.mode === 'light'
          ? theme.palette.grey[100]
          : theme.palette.grey[700],
    },
    [`& .${classKeys.img3}`]: {
      fill:
        theme.palette.mode === 'light'
          ? theme.palette.grey[300]
          : theme.palette.grey[800],
    },
    [`& .${classKeys.img4}`]: {
      fill:
        theme.palette.mode === 'light'
          ? theme.palette.common.white
          : theme.palette.grey[900],
    },
    [`& .${classKeys.img5}`]: {
      fillOpacity: theme.palette.mode === 'light' ? '0.8' : '0.08',
      fill:
        theme.palette.mode === 'light'
          ? theme.palette.grey[100]
          : theme.palette.common.white,
    },
  }),
)

export interface EmptyStateProps extends Omit<BoxProps, 'title'> {
  /** The headline — what is not here. */
  label: ReactNode
  /** One sentence on what to do about it. Optional. */
  description?: ReactNode
  /** The way out: a create button, an upload button. Optional. */
  action?: ReactNode
  /** Drops the illustration where vertical space is tight. */
  compact?: boolean
}

/** The illustration, as its own element so callers can reuse the fills. */
export function EmptyStateIllustration(props: { width?: number }) {
  const { width = 120 } = props
  return (
    <svg
      width={width}
      height={(width / 120) * 100}
      viewBox="0 0 184 152"
      aria-hidden
      focusable="false"
    >
      <g fill="none" fillRule="evenodd">
        <g transform="translate(24 31.67)">
          <ellipse
            className={classKeys.img5}
            cx="67.797"
            cy="106.89"
            rx="67.797"
            ry="12.668"
          />
          <path
            className={classKeys.img1}
            d="M122.034 69.674L98.109 40.229c-1.148-1.386-2.826-2.225-4.593-2.225h-51.44c-1.766 0-3.444.839-4.592 2.225L13.56 69.674v15.383h108.475V69.674z"
          />
          <path
            className={classKeys.img2}
            d="M33.83 0h67.933a4 4 0 0 1 4 4v93.344a4 4 0 0 1-4 4H33.83a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4z"
          />
          <path
            className={classKeys.img3}
            d="M42.678 9.953h50.237a2 2 0 0 1 2 2V36.91a2 2 0 0 1-2 2H42.678a2 2 0 0 1-2-2V11.953a2 2 0 0 1 2-2zM42.94 49.767h49.713a2.262 2.262 0 1 1 0 4.524H42.94a2.262 2.262 0 0 1 0-4.524zM42.94 61.53h49.713a2.262 2.262 0 1 1 0 4.525H42.94a2.262 2.262 0 0 1 0-4.525zM121.813 105.032c-.775 3.071-3.497 5.36-6.735 5.36H20.515c-3.238 0-5.96-2.29-6.734-5.36a7.309 7.309 0 0 1-.222-1.79V69.675h26.318c2.907 0 5.25 2.448 5.25 5.42v.04c0 2.971 2.37 5.37 5.277 5.37h34.785c2.907 0 5.277-2.421 5.277-5.393V75.1c0-2.972 2.343-5.426 5.25-5.426h26.318v33.569c0 .617-.077 1.216-.221 1.789z"
          />
        </g>
        <path
          className={classKeys.img3}
          d="M149.121 33.292l-6.83 2.65a1 1 0 0 1-1.317-1.23l1.937-6.207c-2.589-2.944-4.109-6.534-4.109-10.408C138.802 8.102 148.92 0 161.402 0 173.881 0 184 8.102 184 18.097c0 9.995-10.118 18.097-22.599 18.097-4.528 0-8.744-1.066-12.28-2.902z"
        />
        <g className={classKeys.img4} transform="translate(149.65 15.383)">
          <ellipse cx="20.654" cy="3.167" rx="2.849" ry="2.815" />
          <path d="M5.698 5.63H0L2.898.704zM9.259.704h4.985V5.63H9.259z" />
        </g>
      </g>
    </svg>
  )
}
EmptyStateIllustration.displayName = 'EmptyStateIllustration'

export function EmptyStateComponent(props: EmptyStateProps) {
  const { label, description, action, compact, children, ...rest } = props
  return (
    <EmptyStateRoot {...rest}>
      {compact ? null : <EmptyStateIllustration />}
      <Typography variant="body2" className={classKeys.label}>
        {label}
      </Typography>
      {description ? (
        <Typography
          variant="body2"
          color="text.secondary"
          className={classKeys.description}
        >
          {description}
        </Typography>
      ) : null}
      {action ? <Box className={classKeys.action}>{action}</Box> : null}
      {children}
    </EmptyStateRoot>
  )
}
EmptyStateComponent.displayName = 'EmptyStateComponent'

export default EmptyStateComponent
