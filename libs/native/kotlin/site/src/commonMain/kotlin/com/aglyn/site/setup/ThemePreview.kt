// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.setup

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/*
 * The theme picker's preview of a theme the site is not using yet (the console's `ThemeLibraryCard` and `ThemePreview`,
 * AGL-3668): what `/api/hosts/theme` `preview` answers, read off the very theme the console renders the preview under
 * (`themePreviewKit` in libs/shared/ui/theme). The Swift kit's ThemePreview.swift reads the same answer.
 */

/** One accent as the preview draws it: its fill, the ink on it, and its darker shade. */
data class ThemePreviewAccent(val main: String, val contrastText: String, val dark: String)

/** One rung of the type ramp: the variant, its size at the widest breakpoint in dp, as written, and its weight. */
data class ThemePreviewTypeRung(val key: String, val sizePx: Double, val raw: String, val weight: Int?)

/** A theme in one scheme, as the preview kit draws it; a value the answer lacks is empty. */
data class ThemePreviewKit(
  val fontFamily: String,
  val backgroundDefault: String,
  val backgroundPaper: String,
  val textPrimary: String,
  val textSecondary: String,
  val textDisabled: String,
  val divider: String,
  val primary: ThemePreviewAccent,
  val secondary: ThemePreviewAccent,
  val tertiary: ThemePreviewAccent,
  val error: ThemePreviewAccent,
  val warning: ThemePreviewAccent,
  val info: ThemePreviewAccent,
  val success: ThemePreviewAccent,
  val surfaceMain: String,
  val surfaceContrastText: String,
  val tintPrimary: String,
  val tintSecondary: String,
  val tintTertiary: String,
  val selected: String,
  val radius: Double,
  val typography: List<ThemePreviewTypeRung>,
)

/** What the route answers: the theme's name, whether edits stashed on it are laid over, and the kit in each scheme. */
data class ThemePreviewAnswer(val name: String, val edited: Boolean, val light: ThemePreviewKit, val dark: ThemePreviewKit) {
  fun kit(dark: Boolean): ThemePreviewKit = if (dark) this.dark else light
}

private fun accentOf(json: JsonElement?): ThemePreviewAccent {
  val main = json.str("main").orEmpty()
  return ThemePreviewAccent(main, json.str("contrastText").orEmpty(), json.str("dark") ?: main)
}

/** One scheme's kit from the route's answer. */
fun themePreviewKitOf(json: JsonElement?): ThemePreviewKit = ThemePreviewKit(
  fontFamily = json.str("fontFamily").orEmpty(),
  backgroundDefault = json.obj("background").str("default").orEmpty(),
  backgroundPaper = json.obj("background").str("paper").orEmpty(),
  textPrimary = json.obj("text").str("primary").orEmpty(),
  textSecondary = json.obj("text").str("secondary").orEmpty(),
  textDisabled = json.obj("text").str("disabled").orEmpty(),
  divider = json.str("divider").orEmpty(),
  primary = accentOf(json.obj("primary")),
  secondary = accentOf(json.obj("secondary")),
  tertiary = accentOf(json.obj("tertiary")),
  error = accentOf(json.obj("error")),
  warning = accentOf(json.obj("warning")),
  info = accentOf(json.obj("info")),
  success = accentOf(json.obj("success")),
  surfaceMain = json.obj("surface").str("main").orEmpty(),
  surfaceContrastText = json.obj("surface").str("contrastText").orEmpty(),
  tintPrimary = json.obj("tint").str("primary").orEmpty(),
  tintSecondary = json.obj("tint").str("secondary").orEmpty(),
  tintTertiary = json.obj("tint").str("tertiary").orEmpty(),
  selected = json.str("selected").orEmpty(),
  radius = json.num("radius") ?: 0.0,
  typography = ((json as? JsonObject)?.get("typography") as? JsonArray).orEmpty().mapNotNull { rung ->
    val key = rung.str("key") ?: return@mapNotNull null
    val size = rung.num("sizePx") ?: return@mapNotNull null
    ThemePreviewTypeRung(key, size, rung.str("raw").orEmpty(), rung.num("weight")?.toInt())
  },
)

fun themePreviewAnswerOf(json: JsonElement?): ThemePreviewAnswer = ThemePreviewAnswer(
  name = json.str("name").orEmpty(),
  edited = ((json as? JsonObject)?.get("edited") as? JsonPrimitive)?.booleanOrNull == true,
  light = themePreviewKitOf(json.obj("light")),
  dark = themePreviewKitOf(json.obj("dark")),
)

/** The sentence above the preview, as the console's picker words it. */
fun themePreviewLead(name: String, edited: Boolean): String =
  if (edited) "Previewing $name with the edits you made to it." else "Previewing $name."

/**
 * The note under the preview, as the console's picker words it: using a theme repaints the live site, the theme in use
 * stays in the list (with its edits), and unsaved editor changes are dropped.
 */
fun themePreviewNotice(candidate: String, current: String?, currentEdited: Boolean): String =
  "Using $candidate repaints the live site now. ${current ?: "The current theme"} stays in this list" +
    (if (currentEdited) " with your edits to it," else ",") + " so you can switch back. Unsaved changes in the editor below are discarded."
