package com.aglyn.site.setup

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.pluginhost.NativePluginContext

/**
 * What other plugins put in one of a setup page's zones (`hostBusinessProfile`, `hostSeo`, `hostSettings`), in order:
 * the native twin of the console's `PluginZoneSection`. The page never names the plugins that contribute.
 */
@Composable
internal fun SlotCards(context: NativePluginContext, slot: String) {
  context.slotWidgets(slot).forEach { widget ->
    Box(Modifier.fillMaxWidth().testTag("zone-widget-${widget.id}")) { widget.content(context) }
  }
}

/**
 * Values a plugin's widget proposed for a form (the SEO form's `proposeDraft`), staged as unsaved edits: a proposal lands
 * in the form's fields beside what was typed, the same key twice applies once, and the form's Save is the write.
 */
internal class FormDraft {
  val values = mutableStateMapOf<String, String>()
  private val applied = HashSet<String>()

  /** Bumps whenever a proposal lands, so a form re-reads [values]. */
  var version by mutableStateOf(0)
    private set

  fun propose(proposed: Map<String, String>, key: String) {
    if (!applied.add(key)) return
    values.putAll(proposed)
    version += 1
  }
}
