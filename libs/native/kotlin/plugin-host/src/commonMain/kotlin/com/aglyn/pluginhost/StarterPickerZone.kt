package com.aglyn.pluginhost

import androidx.compose.runtime.staticCompositionLocalOf
import com.aglyn.core.SiteStarterMode
import com.aglyn.core.SiteStarterSummary

/**
 * What Create site hands the widgets in its `hostStarterPicker` zone (the console's `ConsoleHostStarterPickerZoneProps`):
 * what to list, what the person picked, and where each answer goes. Create site never names the plugin that fills it.
 */
class StarterPickerZone(
  val orgId: String,
  val mode: SiteStarterMode,
  val search: String,
  /** The listing shown chosen, and what Create site knows about owning it. */
  val selected: SiteStarterSummary?,
  val onPick: (SiteStarterSummary) -> Unit,
  /** Whether a picker is on screen. The first answer decides, and `false` hands Create site back to its own choice. */
  val ready: (Boolean) -> Unit,
) {
  companion object {
    /** The zone's name, the console's. */
    const val SLOT = "hostStarterPicker"
  }
}

/** Create site's starter zone, while one of its widgets is drawn; null anywhere else. */
val LocalStarterPickerZone = staticCompositionLocalOf<StarterPickerZone?> { null }
