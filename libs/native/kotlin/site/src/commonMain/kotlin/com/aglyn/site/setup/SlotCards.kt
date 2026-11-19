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

  /** Hands over, once, the proposed values a form owns: they leave the draft, so a form opened later never stages them again. */
  fun take(paths: List<String>): Map<String, String> = paths.mapNotNull { path -> values.remove(path)?.let { path to it } }.toMap()

  companion object {
    private val sites = HashMap<String, FormDraft>()

    /**
     * The site's one draft (AGL-4136). The SEO zone proposes into it, and a value for a field another section's card owns
     * (the name, email and phone on Setup → Business profile's Business details) waits here until that card takes it, as
     * the console stages a proposal in the draft of the card that owns its field.
     */
    fun forSite(hostId: String): FormDraft = sites.getOrPut(hostId) { FormDraft() }
  }
}
