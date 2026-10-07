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

import {
  type MobileApiClient,
  type MobileCardReaderAddress,
  type MobileCardReaderSession,
  type MobileCardReaderSetupCode,
  MobileCardReaderSetupError,
} from '@aglyn/mobile-plugin-host'
import {
  requestNeededAndroidPermissions,
  useStripeTerminal,
  type Reader,
} from '@stripe/stripe-terminal-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { collectCardPayment, readCollectRequest, type CollectOutcome } from './collect'
import {
  fetchTerminalSession,
  isSupportedBluetoothReader,
  readerName,
  registerTerminalLocation,
  terminalSession,
} from './context'

/*==========================================
 * THE REGISTER'S CARD READER, AS STATE (AGL-3618).
 *
 * Wraps the Terminal SDK hook into what the screens need: discover Tap to
 * Pay or Bluetooth readers (simulated ones in test mode), connect under the
 * site's Location, install a required reader update, survive a dropped
 * connection (the SDK reconnects on its own; this reports it), and take one
 * payment at a time.
 *=========================================*/

export type ReaderKind = 'tapToPay' | 'bluetooth'

export interface ReaderStatus {
  connected: boolean
  kind: ReaderKind | null
  name: string | null
  connection: Reader.ConnectionStatus
  batteryLevel: number | null
  updating: boolean
  updateProgress: number | null
  /** An update past its deadline must install before this reader takes a payment. */
  updateRequired: boolean
  /** An optional update the merchant can install now. */
  updateAvailable: boolean
  busy: boolean
}

export function usePosTerminal(input: { api: MobileApiClient; hostId: string | null }) {
  const [discovered, setDiscovered] = useState<Reader.Type[]>([])
  const [discovering, setDiscovering] = useState<ReaderKind | null>(null)
  const [connection, setConnection] = useState<Reader.ConnectionStatus>('notConnected')
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateRequired, setUpdateRequired] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [context, setContext] = useState<MobileCardReaderSession | null>(terminalSession())
  /** What the store must set up before a reader can connect, if anything. */
  const [setup, setSetup] = useState<MobileCardReaderSetupCode | null>(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const collecting = useRef(false)

  const terminal = useStripeTerminal({
    onUpdateDiscoveredReaders: (readers) => setDiscovered(readers),
    onFinishDiscoveringReaders: (finishError) => {
      setDiscovering(null)
      if (finishError && String(finishError.code).toUpperCase() !== 'CANCELED') {
        setError(finishError.message)
      }
    },
    onDidChangeConnectionStatus: (status) => setConnection(status),
    onDidStartInstallingUpdate: () => setUpdateProgress(0),
    onDidReportReaderSoftwareUpdateProgress: (progress) => setUpdateProgress(Number(progress) || 0),
    onDidFinishInstallingUpdate: (result) => {
      setUpdateProgress(null)
      if (!result?.error) {
        setUpdateRequired(false)
        setUpdateAvailable(false)
      }
      if (result?.error) setError(result.error.message)
    },
    onDidReportAvailableUpdate: (update) => {
      setUpdateAvailable(true)
      setUpdateRequired(updateIsDue(update?.requiredAt))
    },
    onDidRequestReaderDisplayMessage: (display) => setMessage(readerPrompt(String(display))),
    onDidRequestReaderInput: (inputs) => setMessage(readerInputPrompt(inputs.map(String))),
    onDidStartReaderReconnect: () => setMessage('The reader disconnected. Reconnecting…'),
    onDidSucceedReaderReconnect: () => setMessage('Reader reconnected.'),
    onDidFailReaderReconnect: () => setError('The reader could not reconnect. Connect it again.'),
    onDidDisconnect: () => setMessage(null),
  })

  // A different site: the SDK's cached token belongs to the old one, and so
  // does the connected reader's Location.
  const loadContext = useCallback(
    async (isActive: () => boolean = () => true): Promise<MobileCardReaderSession | null> => {
      if (!input.hostId) return null
      setLoadingContext(true)
      try {
        const next = await fetchTerminalSession(input.api, input.hostId)
        if (isActive()) {
          setContext(next)
          setSetup(null)
        }
        return next
      } catch (caught) {
        if (!isActive()) return null
        if (caught instanceof MobileCardReaderSetupError) {
          setSetup(caught.code)
        } else {
          setError(caught instanceof Error ? caught.message : 'Card readers are not available.')
        }
        return null
      } finally {
        if (isActive()) setLoadingContext(false)
      }
    },
    [input.api, input.hostId],
  )

  useEffect(() => {
    let active = true
    setContext(null)
    setSetup(null)
    void (async () => {
      if (terminal.connectedReader) await terminal.disconnectReader().catch(() => undefined)
      await terminal.clearCachedCredentials().catch(() => undefined)
      await loadContext(() => active)
    })()
    return () => {
      active = false
    }
    // Only a site change resets the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.hostId])

  /** Saves the store address as the Location, then fetches a token under it. */
  const registerLocation = useCallback(
    async (address: MobileCardReaderAddress): Promise<boolean> => {
      if (!input.hostId) return false
      setError(null)
      try {
        await registerTerminalLocation(input.api, input.hostId, address)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The store address could not be saved.')
        return false
      }
      return Boolean(await loadContext())
    },
    [input.api, input.hostId, loadContext],
  )

  const ensureAndroidPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true
    const result = await requestNeededAndroidPermissions({
      accessFineLocation: {
        title: 'Location for card payments',
        message: 'Card networks require the location of in-person payments.',
        buttonPositive: 'Allow',
      },
    })
    if (result.error) {
      setError('Allow location and nearby devices in Settings to use a card reader.')
      return false
    }
    return true
  }, [])

  const discover = useCallback(
    async (kind: ReaderKind, simulated: boolean) => {
      setError(null)
      setDiscovered([])
      if (!(await ensureAndroidPermissions())) return
      if (!terminal.isInitialized) {
        const initialized = await terminal.initialize()
        if (initialized.error) {
          setError(initialized.error.message)
          return
        }
      }
      setDiscovering(kind)
      const result = await terminal.discoverReaders(
        kind === 'tapToPay'
          ? { discoveryMethod: 'tapToPay', simulated }
          : { discoveryMethod: 'bluetoothScan', simulated, timeout: 30 },
      )
      if (result.error && String(result.error.code).toUpperCase() !== 'CANCELED') {
        setError(friendlyDiscoveryError(result.error.code, result.error.message))
      }
      setDiscovering(null)
    },
    [ensureAndroidPermissions, terminal],
  )

  const cancelDiscovery = useCallback(async () => {
    await terminal.cancelDiscovering().catch(() => undefined)
    setDiscovering(null)
  }, [terminal])

  const connect = useCallback(
    async (reader: Reader.Type) => {
      setError(null)
      const current = context ?? (await loadContext())
      if (!current) return false
      setBusy(true)
      try {
        const result =
          reader.deviceType === 'tapToPay'
            ? await terminal.connectReader({
                discoveryMethod: 'tapToPay',
                reader,
                locationId: current.locationId,
                // No `onBehalfOf`: card-present payments settle on the
                // platform account (ToS §10.7, AGL-3607), so the reader
                // connects for the platform and the intent says the rest.
                merchantDisplayName: current.merchantDisplayName,
                // The merchant accepts Apple's Tap to Pay terms on first use,
                // on this screen, with their Apple ID.
                tosAcceptancePermitted: true,
                autoReconnectOnUnexpectedDisconnect: true,
              })
            : await terminal.connectReader({
                discoveryMethod: 'bluetoothScan',
                reader,
                locationId: current.locationId,
                autoReconnectOnUnexpectedDisconnect: true,
              })
        if (result.error) {
          setError(friendlyConnectError(result.error.code, result.error.message))
          return false
        }
        setUpdateRequired(updateIsDue(result.reader?.availableUpdate?.requiredAt))
        setDiscovered([])
        return true
      } finally {
        setBusy(false)
      }
    },
    [context, loadContext, terminal],
  )

  const disconnect = useCallback(async () => {
    await terminal.disconnectReader().catch(() => undefined)
  }, [terminal])

  const installUpdate = useCallback(async () => {
    setError(null)
    const result = await terminal.installAvailableUpdate()
    if (result.error) setError(result.error.message)
  }, [terminal])

  const collect = useCallback(
    async (params: Record<string, unknown>): Promise<CollectOutcome> => {
      const request = readCollectRequest(params)
      if (collecting.current) {
        return { status: 'failed', paymentIntentId: request.paymentIntentId, message: 'A payment is already in progress.' }
      }
      collecting.current = true
      setBusy(true)
      setError(null)
      try {
        return await collectCardPayment(terminal, request, terminal.connectedReader ?? null)
      } finally {
        collecting.current = false
        setBusy(false)
        setMessage(null)
      }
    },
    [terminal],
  )

  const cancel = useCallback(async () => {
    await terminal.cancelCollectPaymentMethod().catch(() => undefined)
    await terminal.cancelConfirmPaymentIntent().catch(() => undefined)
    return { canceled: true }
  }, [terminal])

  const reader = terminal.connectedReader ?? null
  const status: ReaderStatus = useMemo(
    () => ({
      connected: Boolean(reader) && connection === 'connected',
      kind: reader ? (reader.deviceType === 'tapToPay' ? 'tapToPay' : 'bluetooth') : null,
      name: reader ? readerName(reader) : null,
      connection,
      batteryLevel: typeof reader?.batteryLevel === 'number' ? reader.batteryLevel : null,
      updating: updateProgress !== null,
      updateProgress,
      updateRequired,
      updateAvailable: updateAvailable || Boolean(reader?.availableUpdate),
      busy,
    }),
    [busy, connection, reader, updateAvailable, updateProgress, updateRequired],
  )

  const bluetoothReaders = useMemo(
    () => discovered.filter((entry) => entry.deviceType !== 'tapToPay' && isSupportedBluetoothReader(entry)),
    [discovered],
  )
  const tapToPayReader = useMemo(() => discovered.find((entry) => entry.deviceType === 'tapToPay') ?? null, [discovered])

  return {
    status,
    context,
    setup,
    loadingContext,
    registerLocation,
    retrySetup: () => void loadContext(),
    discovering,
    bluetoothReaders,
    tapToPayReader,
    message,
    error,
    clearError: () => setError(null),
    discover,
    cancelDiscovery,
    connect,
    disconnect,
    installUpdate,
    collect,
    cancel,
  }
}

export type PosTerminal = ReturnType<typeof usePosTerminal>

/**
 * Whether an optional reader update has reached its deadline. Updates Stripe
 * marks required install during `connectReader` itself; an optional one only
 * blocks payments once its `requiredAt` passes, so the panel offers it early.
 */
export function updateIsDue(requiredAt: string | undefined, now = Date.now()): boolean {
  if (!requiredAt) return false
  const at = Date.parse(requiredAt)
  return Number.isFinite(at) && at <= now
}

/** What the reader asks the customer, in plain words. */
export function readerPrompt(display: string): string {
  switch (display) {
    case 'removeCard':
      return 'Remove the card.'
    case 'retryCard':
      return 'Try the card again.'
    case 'insertCard':
      return 'Insert the card.'
    case 'insertOrSwipeCard':
      return 'Insert or swipe the card.'
    case 'swipeCard':
      return 'Swipe the card.'
    case 'multipleContactlessCardsDetected':
      return 'More than one card was tapped. Tap just one.'
    case 'tryAnotherReadMethod':
      return 'Try another way to pay with this card.'
    case 'tryAnotherCard':
      return 'Try another card.'
    case 'cardRemovedTooEarly':
      return 'The card was removed too early. Try again.'
    default:
      return 'Follow the prompt on the reader.'
  }
}

export function readerInputPrompt(inputs: string[]): string {
  const ways = inputs
    .map((entry) => (entry === 'tapCard' ? 'tap' : entry === 'insertCard' ? 'insert' : entry === 'swipeCard' ? 'swipe' : ''))
    .filter(Boolean)
  return ways.length ? `Ready: ${ways.join(', ')} the card.` : 'Present the card.'
}

export function friendlyDiscoveryError(code: string, message: string): string {
  switch (String(code).toUpperCase()) {
    case 'TAP_TO_PAY_UNSUPPORTED_DEVICE':
    case 'TAP_TO_PAY_UNSUPPORTED_ANDROID_VERSION':
    case 'TAP_TO_PAY_UNSUPPORTED_IOS_VERSION':
      return 'This device cannot take Tap to Pay. It needs an iPhone XS or later, or an NFC Android phone on Android 13 or later. Use a Bluetooth card reader instead.'
    case 'BLUETOOTH_DISABLED':
    case 'BLUETOOTH_ERROR':
      return 'Turn on Bluetooth to find card readers.'
    case 'BLUETOOTH_PERMISSION_DENIED':
    case 'LOCATION_SERVICES_DISABLED':
      return 'Allow Bluetooth and location for Aglyn POS in Settings to find card readers.'
    default:
      return message || 'Readers could not be found. Try again.'
  }
}

export function friendlyConnectError(code: string, message: string): string {
  switch (String(code).toUpperCase()) {
    case 'TAP_TO_PAY_REQUIRES_ACCEPTED_TERMS':
    case 'TAP_TO_PAY_TERMS_NOT_ACCEPTED':
      return 'Accept the Tap to Pay terms with the account owner’s Apple ID to continue.'
    case 'TAP_TO_PAY_DEVICE_TAMPERED':
      return 'This phone failed a security check and cannot take Tap to Pay.'
    case 'TAP_TO_PAY_INSECURE_ENVIRONMENT':
      return 'Turn off developer options, screen recording and overlays to use Tap to Pay.'
    case 'UNSUPPORTED_READER_VERSION':
      return 'This reader needs a software update. Keep it charged and connected while it updates.'
    default:
      return message || 'The reader could not connect. Try again.'
  }
}
