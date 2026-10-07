package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.ConsoleApiError
import com.aglyn.hardware.CardCollector
import com.aglyn.hardware.CardCollectorKind
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.DeviceReader
import com.aglyn.hardware.ReaderDiscovery
import com.aglyn.hardware.deviceReaders
import com.aglyn.hardware.CardReaderSetupError
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The register's card readers: whether this store can take cards at all,
 * this device's own reader (Tap to Pay or Bluetooth, through the Stripe
 * Terminal SDK) and the smart readers on the counter, paired and removed
 * here through the readers route the console's card uses.
 */
@Composable
fun CardReadersScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  var refresh by remember { mutableIntStateOf(0) }
  var readiness by remember { mutableStateOf<Load<TerminalReadiness>>(Load.Loading) }
  var pos by remember { mutableStateOf<PosContext?>(null) }
  LaunchedEffect(hostId, refresh) {
    readiness = Load.Loading
    readiness = try {
      Load.Ready(CommerceTerminalConnection(context.api).readiness(hostId))
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      Load.Failed(
        (error as? CardReaderSetupError)?.message
          ?: if (error is ConsoleApiError && error.status != 0) error.message else "Card readers could not be checked. Check the connection and try again.",
      )
    }
    pos = runCatching { ConsolePosSaleApi(context.api, hostId).context() }.getOrNull()
  }
  val collector = context.peripherals.cardCollector
  val device by (collector?.state ?: remember { MutableStateFlow<CardCollectorState?>(null) }).collectAsState()

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("pos-card-readers"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      SectionCard("This store") {
        when (val ready = readiness) {
          Load.Loading -> SkeletonList(rows = 2)
          is Load.Failed -> NoticeBanner(ready.message, StatusTone.ERROR, action = { OutlinedButton(onClick = { refresh++ }) { Text("Try again") } })
          is Load.Ready -> {
            val value = ready.value
            Check("Card payments offered here", value.available, if (value.testMode) "Test mode: no real cards are charged." else null)
            Check("Payments set up", value.merchantReady, if (!value.merchantReady) "Finish payments setup before taking cards." else null)
            Check("Store address for card readers", value.locationReady, if (!value.locationReady) "Add the address card readers are used at." else null)
          }
        }
      }
      if (collector != null) DeviceReaderSection(context, hostId, collector, device)
      SmartReadersSection(
        api = remember(context.api, hostId) { ConsoleSmartReadersApi(context.api, hostId) },
        readers = pos?.readers.orEmpty(),
        loading = pos == null && readiness is Load.Loading,
        needsAddress = (readiness as? Load.Ready)?.value?.locationReady == false,
        onChanged = { refresh++ },
      )
    }
  }
}

/**
 * This device's own reader: Tap to Pay on the device, or a Bluetooth reader
 * found nearby. Discovery, the pick and the connection run on the reader's
 * controls; the register's tender buttons follow the connection on their own.
 */
@Composable
private fun DeviceReaderSection(context: NativePluginContext, hostId: String, collector: CardCollector, device: CardCollectorState?) {
  val controls = collector.deviceReaders
  val discovery by controls.discovery.collectAsState()
  val connected by controls.connected.collectAsState()
  val update by controls.update.collectAsState()
  val scope = rememberCoroutineScope()
  val sessions = remember(context.api) { CommerceTerminalConnection(context.api) }
  var busy by remember { mutableStateOf(false) }
  fun run(block: suspend () -> Unit) {
    if (busy) return
    busy = true
    scope.launch {
      try {
        block()
      } finally {
        busy = false
      }
    }
  }

  SectionCard("This device") {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      when (val state = device) {
        is CardCollectorState.Connected -> AglynListItem(
          title = state.label,
          supporting = listOfNotNull(
            if (state.testMode) "Ready · test mode" else "Ready",
            connected?.batteryLevel?.let { "Battery ${(it * 100).roundToInt()}%" },
          ).joinToString(" · "),
          icon = AglynIcons.named(if (state.kind == CardCollectorKind.TAP_TO_PAY) "contactless" else "bluetooth"),
          trailing = {
            if (controls.kinds.isNotEmpty()) {
              OutlinedButton(onClick = { run { controls.disconnect() } }, enabled = !busy, modifier = Modifier.testTag("device-reader-disconnect")) {
                Text("Disconnect")
              }
            } else {
              StatusChip("Connected", StatusTone.SUCCESS)
            }
          },
        )
        is CardCollectorState.Unavailable -> AglynListItem(
          title = "Tap to Pay and Bluetooth readers",
          supporting = state.reason,
          icon = AglynIcons.named("contactless"),
          trailing = { StatusChip("Not available") },
        )
        CardCollectorState.Disconnected, null -> AglynListItem(
          title = "Not connected",
          supporting = if (controls.kinds.isEmpty()) "Open the register to connect this device's reader." else "Take cards on this device, or on a Bluetooth reader near it.",
          icon = AglynIcons.named("contactless"),
        )
      }
      update?.let { pending ->
        val progress = pending.progress
        if (progress != null) {
          Text("Updating the reader… keep it on and nearby.", style = MaterialTheme.typography.bodyMedium)
          LinearProgressIndicator(progress = { progress.toFloat() }, modifier = Modifier.fillMaxWidth())
        } else {
          NoticeBanner(
            if (pending.required) "This reader needs a software update before its next payment." else "A software update is ready for this reader.",
            if (pending.required) StatusTone.WARNING else StatusTone.INFO,
            action = { TextButton(onClick = { run { controls.installUpdate() } }, enabled = !busy) { Text("Install update") } },
          )
        }
      }
      if (device !is CardCollectorState.Connected && device !is CardCollectorState.Unavailable && controls.kinds.isNotEmpty()) {
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), modifier = Modifier.fillMaxWidth()) {
          if (CardCollectorKind.TAP_TO_PAY in controls.kinds) {
            Button(
              onClick = { run { controls.discover(CardCollectorKind.TAP_TO_PAY, hostId, sessions) } },
              enabled = !busy,
              modifier = Modifier.testTag("device-reader-tap-to-pay"),
            ) { Text("Use Tap to Pay") }
          }
          if (CardCollectorKind.BLUETOOTH in controls.kinds) {
            OutlinedButton(
              onClick = { run { controls.discover(CardCollectorKind.BLUETOOTH, hostId, sessions) } },
              enabled = !busy,
              modifier = Modifier.testTag("device-reader-bluetooth"),
            ) { Text("Find Bluetooth readers") }
          }
        }
      }
      when (val found = discovery) {
        ReaderDiscovery.Idle -> Unit
        is ReaderDiscovery.Failed -> NoticeBanner(found.message, StatusTone.ERROR)
        is ReaderDiscovery.Searching -> {
          LinearProgressIndicator(modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Looking for card readers" })
          ReaderChoices(found.found, enabled = false) {}
          TextButton(onClick = { scope.launch { controls.cancelDiscovery() } }) { Text("Stop looking") }
        }
        is ReaderDiscovery.Found -> {
          if (found.found.isEmpty()) {
            Text(
              if (found.kind == CardCollectorKind.TAP_TO_PAY) "Tap to Pay is not available on this device." else "No card reader answered. Turn the reader on, keep it close and try again.",
              style = MaterialTheme.typography.bodyMedium,
            )
          }
          ReaderChoices(found.found, enabled = !busy) { reader -> run { controls.connectTo(reader, hostId, sessions) } }
        }
      }
    }
  }
}

@Composable
private fun ReaderChoices(readers: List<DeviceReader>, enabled: Boolean, onConnect: (DeviceReader) -> Unit) {
  for (reader in readers) {
    AglynListItem(
      title = reader.label,
      supporting = listOfNotNull(
        if (reader.kind == CardCollectorKind.TAP_TO_PAY) "This device" else "Bluetooth",
        reader.batteryLevel?.let { "Battery ${(it * 100).roundToInt()}%" },
      ).joinToString(" · "),
      icon = AglynIcons.named(if (reader.kind == CardCollectorKind.TAP_TO_PAY) "contactless" else "bluetooth"),
      trailing = { Button(onClick = { onConnect(reader) }, enabled = enabled) { Text("Connect") } },
      modifier = Modifier.testTag("device-reader-${reader.id}"),
    )
  }
}

@Composable
private fun Check(title: String, ok: Boolean, detail: String?) {
  AglynListItem(
    title = title,
    supporting = detail,
    icon = AglynIcons.named(if (ok) "check_circle" else "warning"),
    trailing = { StatusChip(if (ok) "Ready" else "Needed", if (ok) StatusTone.SUCCESS else StatusTone.WARNING) },
  )
}

/**
 * The smart readers on the counter (WisePOS E, S700): pair one with the code
 * it shows, or remove one. A store with no reader address yet gives it here.
 */
@Composable
private fun SmartReadersSection(
  api: SmartReadersApi,
  readers: List<PosSmartReader>,
  loading: Boolean,
  needsAddress: Boolean,
  onChanged: () -> Unit,
) {
  val scope = rememberCoroutineScope()
  var pairing by remember { mutableStateOf(false) }
  var removing by remember { mutableStateOf<PosSmartReader?>(null) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  fun run(call: suspend () -> Unit) {
    busy = true
    error = null
    scope.launch {
      try {
        call()
        pairing = false
        removing = null
        onChanged()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.takeIf { it.status != 0 }?.message ?: "That did not go through. Check the connection and try again."
      } finally {
        busy = false
      }
    }
  }

  SectionCard(
    "Smart readers",
    action = { OutlinedButton(onClick = { error = null; pairing = true }, Modifier.testTag("pair-reader")) { Text("Pair a reader") } },
  ) {
    if (loading) {
      SkeletonList(rows = 2)
    } else if (readers.isEmpty()) {
      Text("No smart reader is paired with this store. Pair a WisePOS E or S700 with the code it shows.")
    } else {
      for (reader in readers) {
        AglynListItem(
          title = reader.label,
          supporting = if (reader.livemode) "Live" else "Test mode",
          icon = AglynIcons.named("point_of_sale"),
          trailing = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
              StatusChip(if (reader.online) "Online" else "Offline", if (reader.online) StatusTone.SUCCESS else StatusTone.NEUTRAL)
              IconButton(onClick = { error = null; removing = reader }, Modifier.testTag("remove-reader-${reader.id}")) {
                Icon(AglynIcons.named("delete"), contentDescription = "Remove ${reader.label}")
              }
            }
          },
          modifier = Modifier.testTag("reader-${reader.id}"),
        )
      }
    }
  }

  if (pairing) {
    var code by remember { mutableStateOf("") }
    var label by remember { mutableStateOf("") }
    var line1 by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var state by remember { mutableStateOf("") }
    var postal by remember { mutableStateOf("") }
    var country by remember { mutableStateOf("US") }
    val address = if (needsAddress) ReaderAddress(line1, city, state, postal, country) else null
    val problem = checkReaderPairing(code, address)
    ActionDialog(
      title = "Pair a smart reader",
      body = "On the reader, open Settings and choose Generate pairing code, then enter the code here.",
      icon = "point_of_sale",
      confirmLabel = "Pair reader",
      confirmEnabled = problem == null,
      busy = busy,
      error = error,
      onDismiss = { if (!busy) pairing = false },
      onConfirm = { run { api.pair(code, label, address) } },
    ) {
      OutlinedTextField(code, { code = it }, label = { Text("Pairing code") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("reader-code"))
      OutlinedTextField(label, { label = it }, label = { Text("Name (optional)") }, placeholder = { Text("Front counter") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      if (needsAddress) {
        Text("Where the reader is used", style = MaterialTheme.typography.labelLarge)
        OutlinedTextField(line1, { line1 = it }, label = { Text("Street") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(city, { city = it }, label = { Text("City") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          OutlinedTextField(state, { state = it }, label = { Text("State") }, singleLine = true, modifier = Modifier.weight(1f))
          OutlinedTextField(postal, { postal = it }, label = { Text("Postal code") }, singleLine = true, modifier = Modifier.weight(1f))
          OutlinedTextField(country, { country = it.take(2) }, label = { Text("Country") }, singleLine = true, modifier = Modifier.weight(0.7f))
        }
      }
    }
  }

  removing?.let { reader ->
    ActionDialog(
      title = "Remove ${reader.label}?",
      body = "The reader is unpaired from this store. Pair it again with a new code to use it.",
      icon = "delete",
      confirmLabel = "Remove reader",
      destructive = true,
      busy = busy,
      error = error,
      onDismiss = { if (!busy) removing = null },
      onConfirm = { run { api.remove(reader.id) } },
    )
  }
}
