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
import com.aglyn.hardware.CardReaderSetupError
import com.aglyn.hardware.DeviceReader
import com.aglyn.hardware.DeviceReaderControls
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
import com.stripe.stripeterminal.external.callable.ReaderCallback
import com.stripe.stripeterminal.external.callable.TapToPayReaderListener
import com.stripe.stripeterminal.external.callable.TerminalListener
import com.stripe.stripeterminal.external.models.BatteryStatus
import com.stripe.stripeterminal.external.models.ConnectionConfiguration
import com.stripe.stripeterminal.external.models.ConnectionTokenException
import com.stripe.stripeterminal.external.models.DeviceType
import com.stripe.stripeterminal.external.models.DisconnectReason
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
 */
class StripeTerminalCollector(
  private val context: Context,
  private val simulated: Boolean,
  private val permissions: () -> PermissionGate?,
) : CardCollector, DeviceReaderControls {
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
    mutableDiscovery.value = when {
      error != null && error.errorCode.name != "CANCELED" -> ReaderDiscovery.Failed(friendlyDiscoveryError(error.errorCode.name, error.errorMessage))
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
      try {
        val session = sessions.session(hostId)
        locationId = session.locationId
        merchantName = session.merchantDisplayName
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
        Terminal.init(context.applicationContext, LogLevel.WARNING, tokens, terminalListener, null)
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
