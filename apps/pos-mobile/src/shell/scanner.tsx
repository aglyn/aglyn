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

import { Button, EmptyState, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useCallback, useRef, useState } from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

/*==========================================
 * THE CAMERA SCANNER (AGL-3618).
 *
 * `scanCode(prompt)` on the plugin context: opens the camera full screen,
 * resolves the first barcode or QR code it reads, or null when the person
 * closes it. One scan per open, so a code held in view rings up once. A
 * Bluetooth scanner in keyboard mode needs none of this: it types into the
 * register's search field and presses return.
 *=========================================*/

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'qr', 'datamatrix'] as const

export function useScanner() {
  const [request, setRequest] = useState<{ prompt: string; resolve: (code: string | null) => void } | null>(null)
  const scanCode = useCallback(
    (prompt: string) => new Promise<string | null>((resolve) => setRequest({ prompt, resolve })),
    [],
  )
  const finish = useCallback(
    (code: string | null) => {
      request?.resolve(code)
      setRequest(null)
    },
    [request],
  )
  const modal = request ? <ScannerModal prompt={request.prompt} onDone={finish} /> : null
  return { scanCode, modal }
}

function ScannerModal(props: { prompt: string; onDone: (code: string | null) => void }) {
  const theme = useMobileTheme()
  const [permission, requestPermission] = useCameraPermissions()
  const done = useRef(false)
  const answer = (code: string | null) => {
    if (done.current) return
    done.current = true
    props.onDone(code)
  }
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => answer(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.default }} testID="scanner">
        {permission?.granted ? (
          <View style={{ flex: 1 }}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              onBarcodeScanned={(result) => {
                if (result.data) answer(result.data)
              }}
            />
            <View style={{ padding: theme.space(2), backgroundColor: theme.colors.background.paper }}>
              <Text variant="label" style={{ textAlign: 'center' }}>
                {props.prompt}
              </Text>
            </View>
          </View>
        ) : (
          <EmptyState
            icon="camera-outline"
            title="Allow the camera to scan"
            body={
              permission && !permission.canAskAgain
                ? 'Turn on the camera for Aglyn POS in Settings.'
                : 'Aglyn POS uses the camera only while you scan a barcode.'
            }
            action={
              permission?.canAskAgain !== false ? (
                <Button title="Allow camera" onPress={() => void requestPermission()} />
              ) : undefined
            }
          />
        )}
        <View style={{ padding: theme.space(2) }}>
          <Button title="Close" variant="outlined" onPress={() => answer(null)} />
        </View>
      </SafeAreaView>
    </Modal>
  )
}
