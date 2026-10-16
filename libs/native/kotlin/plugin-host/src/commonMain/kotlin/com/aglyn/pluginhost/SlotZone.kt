package com.aglyn.pluginhost

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Where a zone draws its widgets on a list: in the list's header beside its own create action, or in the list's body
 * (its empty state). A widget reads it to size itself: an icon-sized action in a crowded header, a full button in a body.
 */
enum class SlotPlacement { HEADER, BODY }

/** The placement of the zone a widget is drawn in; [SlotPlacement.BODY] outside one. */
val LocalSlotPlacement = staticCompositionLocalOf { SlotPlacement.BODY }

/**
 * The zones a site's lists host beside their create action, under the console's names: the native twins of the
 * `hostScreens`, `hostTemplates`, `hostLayouts`, `hostComponents` and `hostForms` zones. A list draws its zone and never
 * names the plugins that fill it (the AI plugin's Create with AI is one).
 */
object ListCreateZone {
  const val PAGES = "hostScreens"
  const val TEMPLATES = "hostTemplates"
  const val LAYOUTS = "hostLayouts"
  const val COMPONENTS = "hostComponents"
  const val FORMS = "hostForms"
}

/**
 * What other plugins put in one of a page's zones, in order, each told where it is drawn: the native twin of the
 * console's `PluginWidgetSlot`. Drawn inline, so a header's row lays the widgets out beside its own actions.
 */
@Composable
fun SlotWidgets(context: NativePluginContext, slot: String, placement: SlotPlacement = SlotPlacement.BODY) {
  val widgets = context.slotWidgets(slot)
  if (widgets.isEmpty()) return
  CompositionLocalProvider(LocalSlotPlacement provides placement) {
    widgets.forEach { widget -> widget.content(context) }
  }
}
