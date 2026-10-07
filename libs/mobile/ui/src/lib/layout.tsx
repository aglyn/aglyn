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

/*==========================================
 * PHONE OR TABLET (AGL-3620, AGL-3618).
 *
 * One rule for both apps. A window whose SHORTER side is at least 600 points
 * is a tablet (Android's `sw600dp`, every iPad), and gets the sidebar; the
 * shorter side, so a large phone in landscape stays a phone and an iPad keeps
 * its layout when rotated. A tablet window at least 768 points WIDE also
 * splits: a list and its detail side by side. An iPad in a narrow Split View
 * pane is under 600 on its short side, so it is a phone, as it should be.
 * `layoutFor` is pure, so a spec drives every size.
 *=========================================*/

import type { ReactNode } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { useMobileTheme } from './theme'

export const TABLET_MIN_SHORT_SIDE = 600
export const SPLIT_MIN_WIDTH = 768

export type FormFactor = 'phone' | 'tablet'

export interface MobileLayout {
  /** Same as `formFactor`. */
  kind: FormFactor
  formFactor: FormFactor
  orientation: 'portrait' | 'landscape'
  width: number
  height: number
  landscape: boolean
  /** Show two panes side by side (a list and its detail, a register and its cart). */
  split: boolean
}

export function layoutFor(width: number, height: number): MobileLayout {
  const formFactor: FormFactor = Math.min(width, height) >= TABLET_MIN_SHORT_SIDE ? 'tablet' : 'phone'
  const landscape = width > height
  return {
    kind: formFactor,
    formFactor,
    orientation: landscape ? 'landscape' : 'portrait',
    width,
    height,
    landscape,
    split: formFactor === 'tablet' && width >= SPLIT_MIN_WIDTH,
  }
}

/** Phone or tablet, recomputed on rotation and split-screen resizes. */
export function useLayout(): MobileLayout {
  const { width, height } = useWindowDimensions()
  return layoutFor(width, height)
}

/**
 * List and detail side by side when the window splits; otherwise only
 * `list` renders and the caller pushes the detail as its own screen.
 */
export function SplitView({
  list,
  detail,
  listWidth = 360,
}: {
  list: ReactNode
  detail: ReactNode
  listWidth?: number
}) {
  const { split } = useLayout()
  const theme = useMobileTheme()
  if (!split) return <>{list}</>
  return (
    <View style={styles.row} testID="split-view">
      <View style={[styles.list, { width: listWidth, borderRightColor: theme.colors.divider }]}>{list}</View>
      <View style={styles.detail}>{detail}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  list: { borderRightWidth: StyleSheet.hairlineWidth },
  detail: { flex: 1 },
})
