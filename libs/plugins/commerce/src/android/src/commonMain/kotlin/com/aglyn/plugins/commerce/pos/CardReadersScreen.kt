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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.ConsoleApiError
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.CardReaderSetupError
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException

/**
 * The register's card readers: whether this store can take cards at all,
 * this device's own reader (Tap to Pay or Bluetooth, through the Stripe
 * Terminal SDK) and the smart readers on the counter. Readers are paired and
 * named in the console, which owns their registration.
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
  val device by (collector?.state ?: remember { kotlinx.coroutines.flow.MutableStateFlow<CardCollectorState?>(null) }).collectAsState()

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
            Check("Payments set up in the console", value.merchantReady, if (!value.merchantReady) "Finish payments setup in the console before taking cards." else null)
            Check("Store address for card readers", value.locationReady, if (!value.locationReady) "Add the address card readers are used at." else null)
          }
        }
      }
      SectionCard("This device") {
        when (val state = device) {
          is CardCollectorState.Connected -> AglynListItem(
            title = state.label,
            supporting = if (state.testMode) "Ready · test mode" else "Ready",
            icon = AglynIcons.named("contactless"),
            trailing = { StatusChip("Connected", StatusTone.SUCCESS) },
          )
          is CardCollectorState.Unavailable -> AglynListItem(
            title = "Tap to Pay and Bluetooth readers",
            supporting = state.reason,
            icon = AglynIcons.named("contactless"),
            trailing = { StatusChip("Not available") },
          )
          CardCollectorState.Disconnected -> AglynListItem(
            title = "Not connected",
            supporting = "Open the register to connect this device's reader.",
            icon = AglynIcons.named("contactless"),
          )
          null -> AglynListItem(
            title = "Smart readers only",
            supporting = "This register takes cards on the smart readers below.",
            icon = AglynIcons.named("contactless"),
          )
        }
      }
      SectionCard(
        "Smart readers",
        action = { OutlinedButton(onClick = { context.openConsolePath("/pos", ConsoleScope.SITE) }) { Text("Manage in the console") } },
      ) {
        val readers = pos?.readers.orEmpty()
        if (pos == null && readiness is Load.Loading) {
          SkeletonList(rows = 2)
        } else if (readers.isEmpty()) {
          Text("No smart reader is paired with this store. Pair a WisePOS E or S700 in the console's register.")
        } else {
          for (reader in readers) {
            AglynListItem(
              title = reader.label,
              supporting = if (reader.livemode) "Live" else "Test mode",
              icon = AglynIcons.named("point_of_sale"),
              trailing = { StatusChip(if (reader.online) "Online" else "Offline", if (reader.online) StatusTone.SUCCESS else StatusTone.NEUTRAL) },
              modifier = Modifier.testTag("reader-${reader.id}"),
            )
          }
        }
      }
    }
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
