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

import { Button, EmptyState, Icon, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera'
import { useRef } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/*
 * The camera as a barcode reader (AGL-3621): product barcodes and SKU labels
 * for the catalog, shipping-label codes for a tracking number. One read per
 * opening: the first code the camera settles on is handed over and the
 * scanner closes, so a code held in frame is not read twice.
 */

/** Retail codes a product carries, and the 1D and 2D codes a shipping label carries. */
export const PRODUCT_BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr']
export const SHIPPING_BARCODE_TYPES: BarcodeType[] = ['code128', 'code39', 'datamatrix', 'pdf417', 'qr', 'itf14']

export function BarcodeScanner({
  visible,
  title,
  hint,
  barcodeTypes,
  onScanned,
  onClose,
}: {
  visible: boolean
  title: string
  hint: string
  barcodeTypes: BarcodeType[]
  onScanned: (data: string) => void
  onClose: () => void
}) {
  const theme = useMobileTheme()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const handled = useRef(false)

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onShow={() => {
        handled.current = false
      }}
      onRequestClose={onClose}
    >
      <View style={[styles.fill, { backgroundColor: theme.colors.background.default, paddingTop: insets.top }]}>
        <View style={[styles.header, { padding: theme.space(2) }]}>
          <Text variant="heading" style={styles.fill}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={onClose} testID="scanner-close">
            <Icon name="close" />
          </Pressable>
        </View>
        {!permission ? null : permission.granted ? (
          <View style={styles.fill}>
            <CameraView
              testID="scanner-camera"
              style={styles.fill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes }}
              onBarcodeScanned={({ data }) => {
                const value = String(data ?? '').trim()
                if (!value || handled.current) return
                handled.current = true
                onScanned(value)
              }}
            />
            <View
              style={[
                styles.hint,
                {
                  backgroundColor: theme.colors.background.paper,
                  padding: theme.space(2),
                  paddingBottom: insets.bottom + theme.space(2),
                },
              ]}
            >
              <Text tone="secondary" style={styles.center}>
                {hint}
              </Text>
            </View>
          </View>
        ) : (
          <EmptyState
            icon="camera-outline"
            title="Aglyn needs the camera to scan"
            body={
              permission.canAskAgain
                ? 'Allow camera access to read barcodes. Nothing is recorded.'
                : 'Camera access is off for Aglyn. Turn it on in Settings to scan.'
            }
            action={
              permission.canAskAgain ? (
                <Button title="Allow camera" icon="camera-outline" onPress={() => void requestPermission()} />
              ) : undefined
            }
          />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  hint: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  center: { textAlign: 'center' },
})
