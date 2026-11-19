package com.aglyn.shell

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.OFFLINE_DETAIL
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.LocalAglynPalette
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WithTooltip

/**
 * The connection indicator in the title bar (the console's `OfflineIndicator`, AGL-1056): nothing at all while online, and an
 * "Offline" warning pill while the device has no network, so nobody keeps editing while every write quietly fails. The live
 * region is always there, so the change is announced the moment it comes.
 */
@Composable
internal fun OfflineIndicator(services: ShellServices) {
  val online by services.connectivity.online.collectAsState()
  Row(
    Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("offline-indicator"),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (!online) {
      WithTooltip(OFFLINE_DETAIL) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(AglynIcons.named("wifi_off"), contentDescription = null, Modifier.size(16.dp), tint = LocalAglynPalette.current.warning.text)
          Spacer(Modifier.width(4.dp))
          StatusChip("Offline", StatusTone.WARNING, Modifier.padding(end = 4.dp))
        }
      }
    }
  }
}
