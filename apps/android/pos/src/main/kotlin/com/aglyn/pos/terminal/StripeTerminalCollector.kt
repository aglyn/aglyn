package com.aglyn.pos.terminal

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.aglyn.hardware.CardCollectOutcome
import com.aglyn.hardware.CardCollectRequest
import com.aglyn.hardware.CardCollector
import com.aglyn.hardware.CardCollectorKind
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.CardReaderSessionSource
import com.aglyn.hardware.CardReaderSetupCode
import com.aglyn.hardware.CardReaderSetupError
import com.aglyn.hardware.DeviceReader
import com.aglyn.hardware.DeviceReaderControls
import com.aglyn.hardware.OfflineCardCollector
import com.aglyn.hardware.OfflineCardForwardLedger
import com.aglyn.hardware.OfflineCardOutcome
import com.aglyn.hardware.OfflineCardRequest
import com.aglyn.hardware.collectOfflineCardPayment
import com.aglyn.hardware.ReaderDiscovery
import com.aglyn.hardware.ReaderUpdate
import com.aglyn.hardware.collectCardPayment
import com.aglyn.hardware.deviceReaderLabel
import com.aglyn.hardware.friendlyConnectError
import com.aglyn.hardware.friendlyDiscoveryError
import com.aglyn.hardware.readerInputPrompt
import com.aglyn.hardware.readerPrompt
import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.external.callable.Callback
import com.stripe.stripeterminal.external.callable.Cancelable
import com.stripe.stripeterminal.external.callable.ConnectionTokenCallback
import com.stripe.stripeterminal.external.callable.ConnectionTokenProvider
import com.stripe.stripeterminal.external.callable.DiscoveryListener
import com.stripe.stripeterminal.external.callable.MobileReaderListener
import com.stripe.stripeterminal.external.callable.OfflineListener
import com.stripe.stripeterminal.external.callable.ReaderCallback
import com.stripe.stripeterminal.external.callable.TapToPayReaderListener
import com.stripe.stripeterminal.external.callable.TerminalListener
import com.stripe.stripeterminal.external.models.BatteryStatus
import com.stripe.stripeterminal.external.models.ConnectionConfiguration
import com.stripe.stripeterminal.external.models.ConnectionTokenException
import com.stripe.stripeterminal.external.models.DeviceType
import com.stripe.stripeterminal.external.models.DisconnectReason
import com.stripe.stripeterminal.external.models.OfflineStatus
import com.stripe.stripeterminal.external.models.PaymentIntent
import com.stripe.stripeterminal.external.models.SimulatedOfflineMode
import com.stripe.stripeterminal.external.models.SimulatedOfflineModeConfiguration
import com.stripe.stripeterminal.external.models.SimulatorConfiguration
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration
import com.stripe.stripeterminal.external.models.Reader
import com.stripe.stripeterminal.external.models.ReaderDisplayMessage
import com.stripe.stripeterminal.external.models.ReaderInputOptions
import com.stripe.stripeterminal.external.models.ReaderSoftwareUpdate
import com.stripe.stripeterminal.external.models.TerminalException
import com.stripe.stripeterminal.log.LogLevel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume

/**
 * Asks the person for runtime permissions; the activity on screen answers.
 * False when any is refused (or no activity is there to ask).
 */
fun interface PermissionGate {
  suspend fun request(permissions: List<String>): Boolean
}

/*
 * THIS DEVICE'S CARD READER, ON THE STRIPE TERMINAL ANDROID SDK.
 *
 * Tap to Pay on this phone or tablet, or a Bluetooth reader (Stripe M2,
 * WisePad 3, Chipper 2X). The SDK is initialized lazily, the first time a
 * reader is wanted, after the cashier allows location and nearby devices.
 * Connection tokens come from commerce's `pos-terminal-connection-token`
 * route for the open site, scoped to that site's Terminal Location; a site
 * change disconnects and clears the SDK's cached token. Readers connect with
 * no `onBehalfOf`: card-present payments settle on the platform account and
 * the server's intent decides the rest.
 *
 * [simulated] runs the SDK's simulated readers (test mode). Until live
 * readers are switched on for a build, every build is simulated.
 *
 * WITH NO CONNECTION (AGL-4039) a Bluetooth reader still takes cards: the app
 * creates the intent itself ([SdkOfflinePort], the sequence in the shared
 * hardware kit) and the SDK stores the card until a connection returns, then
 * forwards it and tells [OfflineListener], which writes the outcome to
 * [forwards] for the register. The site's Location and merchant name are
 * remembered per site, so the SDK can start and the reader can reconnect while
 * the console cannot be reached. Tap to Pay on Android cannot store cards.
 */
class StripeTerminalCollector(
  private val context: Context,
  private val simulated: Boolean,
  private val permissions: () -> PermissionGate?,
  /** What the SDK did with cards it stored offline, shared with the register (AGL-4039). */
  private val forwards: OfflineCardForwardLedger,
  /** Debug builds: a simulated reader goes offline with the register, so store and forward can be driven on an emulator. */
  private val mirrorOfflineToStripe: Boolean = false,
) : CardCollector, DeviceReaderControls, OfflineCardCollector {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val lock = Mutex()

  private val mutableState = MutableStateFlow<CardCollectorState>(CardCollectorState.Disconnected)
  override val state: StateFlow<CardCollectorState> = mutableState
  private val mutableDiscovery = MutableStateFlow<ReaderDiscovery>(ReaderDiscovery.Idle)
  override val discovery: StateFlow<ReaderDiscovery> = mutableDiscovery
  private val mutableConnected = MutableStateFlow<DeviceReader?>(null)
  override val connected: StateFlow<DeviceReader?> = mutableConnected
  private val mutablePrompt = MutableStateFlow<String?>(null)
  override val prompt: StateFlow<String?> = mutablePrompt
  private val mutableUpdate = MutableStateFlow<ReaderUpdate?>(null)
  override val update: StateFlow<ReaderUpdate?> = mutableUpdate

  override val kinds: List<CardCollectorKind> by lazy {
    buildList {
      if (tapToPayPossible()) add(CardCollectorKind.TAP_TO_PAY)
      add(CardCollectorKind.BLUETOOTH)
    }
  }

  /** The site whose tokens the SDK is using, and where they come from. */
  private var hostId: String? = null
  private var sessions: CardReaderSessionSource? = null
  private var locationId: String? = null
  private var merchantName: String = "Store"

  /** Discovered SDK readers by id, so a pick maps back to the SDK object. */
  private val found = LinkedHashMap<String, Reader>()
  private var discovering: Cancelable? = null
  private var collecting: Cancelable? = null

  override var onOfflineForward: (() -> Unit)? = null

  // ---- OfflineCardCollector (AGL-4039)

  override val offlineCardUnavailableReason: String?
    get() {
      val connected = mutableState.value as? CardCollectorState.Connected ?: return "Connect the card reader to take cards offline."
      return if (connected.kind == CardCollectorKind.TAP_TO_PAY) {
        "Tap to Pay cannot take cards offline on Android. Connect a Bluetooth card reader, or take cash."
      } else {
        null
      }
    }

  override suspend fun collectOffline(request: OfflineCardRequest): OfflineCardOutcome {
    if (collecting != null) return OfflineCardOutcome.Failed("A payment is already in progress.")
    return try {
      collectOfflineCardPayment(SdkOfflinePort(terminal(), onCancelable = { collecting = it }), request, mutableConnected.value)
    } finally {
      collecting = null
      mutablePrompt.value = null
    }
  }

  override fun registerConnectivityChanged(online: Boolean) {
    if (!mirrorOfflineToStripe || !simulated || !Terminal.isInitialized()) return
    val mode = if (online) SimulatedOfflineMode.DISABLED else SimulatedOfflineMode.OFFLINE_IMMEDIATE
    runCatching { Terminal.getInstance().simulatedOfflineModeConfiguration = SimulatedOfflineModeConfiguration(mode, SimulatedOfflineMode.DISABLED) }
  }

  private val offlineListener = object : OfflineListener {
    override fun onOfflineStatusChange(offlineStatus: OfflineStatus) = Unit

    override fun onPaymentIntentForwarded(paymentIntent: PaymentIntent, e: TerminalException?) {
      val forward = paymentIntent.asOfflineForward(e) ?: return
      forwards.record(forward)
      scope.launch { onOfflineForward?.invoke() }
    }

    // A forward that failed without naming its payment is retried by the SDK; nothing to record.
    override fun onForwardingFailure(e: TerminalException) = Unit
  }

  // ---- CardCollector

  override suspend fun connect(hostId: String, sessions: CardReaderSessionSource): CardCollectorState {
    if (!prepare(hostId, sessions, ask = false)) return mutableState.value
    if (mutableConnected.value != null) return mutableState.value
    // A Tap to Pay device is its own reader: reconnect it without asking.
    val remembered = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_KIND, null)
    if (remembered == CardCollectorKind.TAP_TO_PAY.name && CardCollectorKind.TAP_TO_PAY in kinds) {
      discover(CardCollectorKind.TAP_TO_PAY, hostId, sessions)
      (mutableDiscovery.value as? ReaderDiscovery.Found)?.found?.firstOrNull()?.let { connectTo(it, hostId, sessions) }
    }
    return mutableState.value
  }

  override suspend fun collect(request: CardCollectRequest): CardCollectOutcome {
    if (collecting != null) return CardCollectOutcome.Failed(request.paymentIntentId, "A payment is already in progress.")
    return try {
      collectCardPayment(SdkPaymentPort(terminal(), onCancelable = { collecting = it }), request, mutableConnected.value)
    } finally {
      collecting = null
      mutablePrompt.value = null
    }
  }

  override suspend fun cancel() {
    val pending = collecting ?: return
    suspendCancellableCoroutine { done ->
      pending.cancel(object : Callback {
        override fun onSuccess() = done.resume(Unit)
        override fun onFailure(e: TerminalException) = done.resume(Unit)
      })
    }
  }

  // ---- DeviceReaderControls

  override suspend fun discover(kind: CardCollectorKind, hostId: String, sessions: CardReaderSessionSource) {
    if (!prepare(hostId, sessions, ask = true)) return
    cancelDiscovery()
    found.clear()
    mutableDiscovery.value = ReaderDiscovery.Searching(kind)
    val config = when (kind) {
      CardCollectorKind.TAP_TO_PAY -> DiscoveryConfiguration.TapToPayDiscoveryConfiguration(simulated)
      else -> DiscoveryConfiguration.BluetoothDiscoveryConfiguration(DISCOVERY_SECONDS, simulated)
    }
    val error = suspendCancellableCoroutine<TerminalException?> { done ->
      val listener = object : DiscoveryListener {
        override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
          val usable = readers.filter { kindOf(it.deviceType) == kind }
          usable.forEach { found[readerId(it)] = it }
          mutableDiscovery.value = ReaderDiscovery.Searching(kind, usable.map(::asDeviceReader))
          // Tap to Pay finds exactly this device; there is nothing more to wait for.
          if (kind == CardCollectorKind.TAP_TO_PAY && usable.isNotEmpty()) discovering?.cancel(NOOP)
        }
      }
      discovering = terminal().discoverReaders(config, listener, object : Callback {
        override fun onSuccess() { if (done.isActive) done.resume(null) }
        override fun onFailure(e: TerminalException) { if (done.isActive) done.resume(e) }
      })
      done.invokeOnCancellation { discovering?.cancel(NOOP) }
    }
    discovering = null
    val list = found.values.map(::asDeviceReader)
    val code = error?.errorCode?.name
    mutableDiscovery.value = when {
      // A search that found readers and then timed out keeps them listed to connect (as on Apple).
      error != null && code != "CANCELED" && !(code == "BLUETOOTH_SCAN_TIMED_OUT" && list.isNotEmpty()) ->
        ReaderDiscovery.Failed(friendlyDiscoveryError(code ?: "", error.errorMessage))
      else -> ReaderDiscovery.Found(kind, list)
    }
  }

  override suspend fun cancelDiscovery() {
    val pending = discovering ?: return
    if (!pending.isCompleted) {
      suspendCancellableCoroutine { done ->
        pending.cancel(object : Callback {
          override fun onSuccess() = done.resume(Unit)
          override fun onFailure(e: TerminalException) = done.resume(Unit)
        })
      }
    }
    discovering = null
  }

  override suspend fun connectTo(reader: DeviceReader, hostId: String, sessions: CardReaderSessionSource): Boolean {
    if (!prepare(hostId, sessions, ask = true)) return false
    val sdkReader = found[reader.id] ?: return false.also {
      mutableDiscovery.value = ReaderDiscovery.Failed("Find the reader again, then connect.")
    }
    val location = locationId ?: return false
    cancelDiscovery()
    val config = when (reader.kind) {
      CardCollectorKind.TAP_TO_PAY -> ConnectionConfiguration.TapToPayConnectionConfiguration(location, true, tapToPayListener)
      else -> ConnectionConfiguration.BluetoothConnectionConfiguration(location, true, mobileListener)
    }
    val result = suspendCancellableCoroutine<Result<Reader>> { done ->
      terminal().connectReader(sdkReader, config, object : ReaderCallback {
        override fun onSuccess(reader: Reader) = done.resume(Result.success(reader))
        override fun onFailure(e: TerminalException) = done.resume(Result.failure(e))
      })
    }
    return result.fold(
      onSuccess = { connectedReader ->
        markConnected(connectedReader)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_KIND, reader.kind.name).apply()
        mutableDiscovery.value = ReaderDiscovery.Idle
        true
      },
      onFailure = { error ->
        val e = error as? TerminalException
        mutableDiscovery.value = ReaderDiscovery.Failed(friendlyConnectError(e?.errorCode?.name ?: "", e?.errorMessage))
        false
      },
    )
  }

  override suspend fun disconnect() {
    if (!Terminal.isInitialized() || Terminal.getInstance().connectedReader == null) return markDisconnected()
    suspendCancellableCoroutine { done ->
      Terminal.getInstance().disconnectReader(object : Callback {
        override fun onSuccess() = done.resume(Unit)
        override fun onFailure(e: TerminalException) = done.resume(Unit)
      })
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_KIND).apply()
    markDisconnected()
  }

  override suspend fun installUpdate() {
    if (Terminal.isInitialized()) Terminal.getInstance().installAvailableUpdate()
  }

  // ---- setup

  /**
   * Initializes the SDK (once) and points its tokens at [hostId]. False, with
   * the state saying why, when permissions are refused or the site is not
   * set up for card readers. [ask] false never prompts: opening the register
   * reconnects silently or not at all.
   */
  private suspend fun prepare(hostId: String, sessions: CardReaderSessionSource, ask: Boolean): Boolean = lock.withLock {
    val needed = requiredPermissions().filter { context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
    if (needed.isNotEmpty()) {
      val granted = ask && (permissions()?.request(needed) ?: false)
      if (!granted) {
        if (ask) mutableDiscovery.value = ReaderDiscovery.Failed(PERMISSIONS_NEEDED)
        return false
      }
    }
    if (this.hostId != hostId) {
      if (Terminal.isInitialized()) {
        if (Terminal.getInstance().connectedReader != null) {
          suspendCancellableCoroutine { done ->
            Terminal.getInstance().disconnectReader(object : Callback {
              override fun onSuccess() = done.resume(Unit)
              override fun onFailure(e: TerminalException) = done.resume(Unit)
            })
          }
        }
        Terminal.getInstance().clearCachedCredentials()
      }
      markDisconnected()
      this.hostId = hostId
      this.sessions = sessions
      locationId = null
    }
    if (locationId == null) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      try {
        val session = sessions.session(hostId)
        locationId = session.locationId
        merchantName = session.merchantDisplayName
        prefs.edit().putString("$KEY_SITE$hostId", "${session.locationId}\t${session.merchantDisplayName}").apply()
      } catch (lost: CardReaderSetupError) {
        if (lost.code != CardReaderSetupCode.UNREACHABLE) {
          mutableState.value = CardCollectorState.Unavailable(lost.message ?: "Card readers are not set up for this store yet.")
          if (ask) mutableDiscovery.value = ReaderDiscovery.Failed(lost.message ?: "Card readers are not set up for this store yet.")
          return false
        }
        // No connection: start from what this site's reader last saw online, so a card can be stored (AGL-4039).
        val known = prefs.getString("$KEY_SITE$hostId", null)?.split('\t')
        if (known == null || known.size != 2) {
          mutableState.value = CardCollectorState.Unavailable("Card readers are not set up for this store yet.")
          if (ask) mutableDiscovery.value = ReaderDiscovery.Failed("Connect once so the card reader can get ready to work offline.")
          return false
        }
        locationId = known[0]
        merchantName = known[1]
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        val words = (error as? CardReaderSetupError)?.message ?: error.message ?: "Card readers are not set up for this store yet."
        mutableState.value = CardCollectorState.Unavailable(words)
        if (ask) mutableDiscovery.value = ReaderDiscovery.Failed(words)
        return false
      }
    }
    if (!Terminal.isInitialized()) {
      try {
        Terminal.init(context.applicationContext, LogLevel.WARNING, tokens, terminalListener, offlineListener)
        // The simulated reader stores cards offline only when asked to (test mode).
        if (simulated) Terminal.getInstance().simulatorConfiguration = SimulatorConfiguration(offlineEnabled = true)
      } catch (error: TerminalException) {
        mutableState.value = CardCollectorState.Unavailable(friendlyDiscoveryError(error.errorCode.name, error.errorMessage))
        return false
      }
    }
    if (mutableState.value is CardCollectorState.Unavailable) mutableState.value = CardCollectorState.Disconnected
    true
  }

  private fun terminal(): Terminal = Terminal.getInstance()

  /** Mints a token for the open site whenever the SDK asks. */
  private val tokens = object : ConnectionTokenProvider {
    override fun fetchConnectionToken(callback: ConnectionTokenCallback) {
      val site = hostId
      val source = sessions
      if (site == null || source == null) return callback.onFailure(ConnectionTokenException("No store is open."))
      scope.launch {
        try {
          callback.onSuccess(source.session(site).secret)
        } catch (error: Throwable) {
          if (error is CancellationException) throw error
          callback.onFailure(ConnectionTokenException(error.message ?: "The card reader token could not be fetched.", error))
        }
      }
    }
  }

  private val terminalListener = object : TerminalListener {}

  private val readerEvents = object {
    fun display(message: ReaderDisplayMessage) { mutablePrompt.value = readerPrompt(message.name) }
    fun input(options: ReaderInputOptions) { mutablePrompt.value = readerInputPrompt(options.options.map { it.name }) }
  }

  private val mobileListener = object : MobileReaderListener {
    override fun onRequestReaderDisplayMessage(message: ReaderDisplayMessage) = readerEvents.display(message)
    override fun onRequestReaderInput(options: ReaderInputOptions) = readerEvents.input(options)
    override fun onReportAvailableUpdate(update: ReaderSoftwareUpdate) {
      mutableUpdate.value = ReaderUpdate(required = update.requiredAtMs in 1..System.currentTimeMillis())
    }
    override fun onStartInstallingUpdate(update: ReaderSoftwareUpdate, cancelable: Cancelable?) {
      mutableUpdate.value = ReaderUpdate(progress = 0.0, required = true)
    }
    override fun onReportReaderSoftwareUpdateProgress(progress: Float) {
      mutableUpdate.value = (mutableUpdate.value ?: ReaderUpdate()).copy(progress = progress.toDouble())
    }
    override fun onFinishInstallingUpdate(update: ReaderSoftwareUpdate?, e: TerminalException?) {
      mutableUpdate.value = if (e == null) null else ReaderUpdate(required = mutableUpdate.value?.required ?: false)
    }
    override fun onBatteryLevelUpdate(batteryLevel: Float, batteryStatus: BatteryStatus, isCharging: Boolean) {
      mutableConnected.value = mutableConnected.value?.copy(batteryLevel = batteryLevel.toDouble())
    }
    override fun onDisconnect(reason: DisconnectReason) = markDisconnected()
    override fun onReaderReconnectSucceeded(reader: Reader) = markConnected(reader)
    override fun onReaderReconnectFailed(reader: Reader) = markDisconnected()
  }

  private val tapToPayListener = object : TapToPayReaderListener {
    override fun onDisconnect(reason: DisconnectReason) = markDisconnected()
    override fun onReaderReconnectSucceeded(reader: Reader) = markConnected(reader)
    override fun onReaderReconnectFailed(reader: Reader) = markDisconnected()
  }

  private fun markConnected(reader: Reader) {
    val device = asDeviceReader(reader)
    mutableConnected.value = device
    mutableState.value = CardCollectorState.Connected(device.label, device.kind, testMode = reader.isSimulated || reader.livemode == false)
    reader.availableUpdate?.let { mutableUpdate.value = ReaderUpdate(required = it.requiredAtMs in 1..System.currentTimeMillis()) }
  }

  private fun markDisconnected() {
    mutableConnected.value = null
    mutablePrompt.value = null
    mutableUpdate.value = null
    if (mutableState.value is CardCollectorState.Connected) mutableState.value = CardCollectorState.Disconnected
  }

  private fun asDeviceReader(reader: Reader): DeviceReader {
    val kind = kindOf(reader.deviceType) ?: CardCollectorKind.BLUETOOTH
    return DeviceReader(
      id = readerId(reader),
      label = deviceReaderLabel(kind, reader.deviceType.name, reader.label, reader.serialNumber, reader.isSimulated),
      kind = kind,
      simulated = reader.isSimulated,
      batteryLevel = reader.batteryLevel?.toDouble(),
      deviceType = reader.deviceType.name,
    )
  }

  private fun readerId(reader: Reader): String = reader.serialNumber ?: reader.id ?: reader.deviceType.name

  private fun kindOf(type: DeviceType): CardCollectorKind? = when (type) {
    DeviceType.TAP_TO_PAY_DEVICE -> CardCollectorKind.TAP_TO_PAY
    DeviceType.STRIPE_M2, DeviceType.WISEPAD_3, DeviceType.WISEPAD_3S, DeviceType.CHIPPER_2X -> CardCollectorKind.BLUETOOTH
    else -> null
  }

  private fun tapToPayPossible(): Boolean =
    simulated || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC))

  companion object {
    private const val TAG = "AglynTerminal"
    private const val PREFS = "aglyn-pos-terminal"
    private const val KEY_KIND = "readerKind"
    private const val KEY_SITE = "site:"
    private const val DISCOVERY_SECONDS = 30
    const val PERMISSIONS_NEEDED = "Allow location and nearby devices for Aglyn POS to use a card reader. Card networks require the location of in-person payments."

    private val NOOP = object : Callback {
      override fun onSuccess() = Unit
      override fun onFailure(e: TerminalException) { Log.d(TAG, "cancel: ${e.errorCode}") }
    }

    /**
     * What the SDK's own manifest declares it needs: fine location through
     * Android 11; coarse location plus Bluetooth scan and connect from
     * Android 12.
     */
    fun requiredPermissions(): List<String> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      listOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      listOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
  }
}
