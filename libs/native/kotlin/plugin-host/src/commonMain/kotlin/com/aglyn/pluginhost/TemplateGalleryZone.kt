// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.pluginhost

import androidx.compose.runtime.staticCompositionLocalOf

/** How a shelf in the template gallery stands (`ConsoleTemplateGalleryShelfState`), so its "nothing matches" line counts it. */
enum class TemplateGalleryShelfState { LOADING, SHOWN, EMPTY }

/**
 * What the template gallery hands the widgets in its `templateGallery` zone (the console's `ConsoleTemplateGalleryZoneProps`,
 * AGL-3080): the site a template installs into, the kind being picked, the search word, and where each answer goes. The
 * gallery never names the plugin that fills it. The Swift kit's `TemplateGalleryZone`.
 */
class TemplateGalleryZone(
  val hostId: String,
  /** `page`, `component` or `layout`; a shelf offering one kind draws nothing for the others. */
  val kind: String,
  /** The word typed in the gallery's search, `""` for none. */
  val search: String,
  /** Closes the gallery once an install has landed in the library, with what to tell the person. */
  val onInstalled: (String) -> Unit,
  /** Says how a shelf stands, keyed by a name the widget keeps. */
  val reportShelf: (String, TemplateGalleryShelfState) -> Unit,
) {
  companion object {
    /** The zone's name, the console's. */
    const val SLOT = "templateGallery"
  }
}

/** The template gallery's zone, while one of its widgets is drawn; null anywhere else. */
val LocalTemplateGalleryZone = staticCompositionLocalOf<TemplateGalleryZone?> { null }
