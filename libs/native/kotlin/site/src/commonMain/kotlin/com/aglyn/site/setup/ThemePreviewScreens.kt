// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.setup

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.parseCssColor
import com.aglyn.ui.space

/** A theme the picker previews before it is used: its kind and id as the theme route names them, and its name. */
data class ThemePreviewTarget(val kind: String, val id: String?, val name: String)

/**
 * The picker's two steps, as the console's: a theme is previewed here, light or dark, and applied only on "Use this theme",
 * because a theme repaints the live site the moment it is used. The Swift kit's `ThemePreviewSheet`.
 */
@Composable
internal fun ThemePreviewDialog(
  target: ThemePreviewTarget,
  api: HostSettingsApi,
  currentName: String?,
  currentEdited: Boolean,
  canManage: Boolean,
  runner: ActionRunner,
  onClose: () -> Unit,
) {
  var answer by remember(target) { mutableStateOf<ThemePreviewAnswer?>(null) }
  var failed by remember(target) { mutableStateOf<String?>(null) }
  var dark by remember(target) { mutableStateOf(false) }
  LaunchedEffect(target) {
    try {
      answer = api.previewTheme(target.kind, target.id)
    } catch (error: Throwable) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      failed = (error as? ConsoleApiError)?.message ?: "The preview could not be loaded. Try again."
    }
  }
  ActionDialog(
    title = target.name,
    confirmLabel = "Use this theme",
    confirmEnabled = canManage && answer != null,
    busy = runner.busy,
    error = runner.error,
    icon = "palette",
    onDismiss = onClose,
    onConfirm = { runner.run("This site now uses ${target.name}.", onDone = onClose) { api.selectTheme(target.kind, target.id) } },
    modifier = Modifier.testTag("theme-preview"),
  ) {
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      val loaded = answer
      when {
        failed != null -> NoticeBanner(failed!!, StatusTone.ERROR)
        loaded == null -> SkeletonList(rows = 6)
        else -> {
          Text(themePreviewLead(target.name, loaded.edited), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().testTag("theme-preview-scheme")) {
            listOf(false to "Light", true to "Dark").forEachIndexed { index, (value, label) ->
              SegmentedButton(selected = dark == value, onClick = { dark = value }, shape = SegmentedButtonDefaults.itemShape(index, 2), icon = {}) {
                Text(label)
              }
            }
          }
          ThemePreviewKitView(loaded.kit(dark))
          NoticeBanner(themePreviewNotice(target.name, currentName, currentEdited), StatusTone.INFO)
        }
      }
    }
  }
}

/**
 * The console's `ThemePreview` sample kit, drawn in the theme's own colours, corner radius and type ramp: an app bar, the
 * ramp, buttons and chips in each accent, the status colours, a card, the surface and the tints, a field, alerts and a
 * selected row. The site's fonts are not loaded in the app; sizes and weights are the theme's.
 */
@Composable
internal fun ThemePreviewKitView(kit: ThemePreviewKit) {
  fun color(css: String, fallback: Color = Color.Transparent) = parseCssColor(css) ?: fallback
  val ink = color(kit.textPrimary, MaterialTheme.colorScheme.onSurface)
  val muted = color(kit.textSecondary, MaterialTheme.colorScheme.onSurfaceVariant)
  val shape = RoundedCornerShape(kit.radius.dp)
  fun rung(key: String) = kit.typography.firstOrNull { it.key == key }
  fun weight(rung: ThemePreviewTypeRung?) = FontWeight((rung?.weight ?: 400).coerceIn(100, 900))
  val h6 = rung("h6")
  Column(Modifier.fillMaxWidth().clip(shape).background(color(kit.backgroundDefault)).border(1.dp, color(kit.divider), shape).testTag("theme-preview-kit")) {
    Row(Modifier.fillMaxWidth().background(color(kit.primary.main, MaterialTheme.colorScheme.primary)).padding(space(2f))) {
      Text("Site preview", Modifier.weight(1f), color = color(kit.primary.contrastText, Color.White), fontSize = (h6?.sizePx ?: 20.0).sp, fontWeight = weight(h6))
      Text("Action", color = color(kit.primary.contrastText, Color.White), style = MaterialTheme.typography.labelLarge)
    }
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        kit.typography.forEach { r ->
          Row(Modifier.fillMaxWidth()) {
            Text(r.key, Modifier.weight(1f), color = ink, fontSize = r.sizePx.sp, fontWeight = weight(r), maxLines = 1, overflow = TextOverflow.Clip)
            Text("${r.raw} · ${r.weight ?: ""}", color = color(kit.textDisabled, muted), style = MaterialTheme.typography.bodySmall)
          }
        }
        Text(
          buildAnnotatedString {
            append("Body copy shows the font family, size, and text colors. ")
            withStyle(SpanStyle(color = color(kit.primary.main))) { append("A link") }
            append(" sits inline with the text.")
          },
          color = ink,
        )
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Filled("Primary", kit.primary, shape, ::color)
        Filled("Secondary", kit.secondary, shape, ::color)
        Filled("Tertiary", kit.tertiary, shape, ::color)
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Text("Outlined", Modifier.border(BorderStroke(1.dp, color(kit.primary.main)), shape).padding(horizontal = space(1.5f), vertical = space(1f)), color = color(kit.primary.main), style = MaterialTheme.typography.labelLarge)
        Text("Text", Modifier.padding(horizontal = space(1f), vertical = space(1f)), color = color(kit.primary.main), style = MaterialTheme.typography.labelLarge)
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
        listOf("Error" to kit.error, "Warning" to kit.warning, "Info" to kit.info, "Success" to kit.success).forEach { (label, accent) ->
          Text(label, Modifier.background(color(accent.main), RoundedCornerShape(50)).padding(horizontal = space(1f), vertical = space(0.5f)), color = color(accent.contrastText), style = MaterialTheme.typography.labelMedium)
        }
      }
      Column(Modifier.fillMaxWidth().background(color(kit.backgroundPaper), shape).border(1.dp, color(kit.divider), shape).padding(space(2f))) {
        Text("Card title", color = ink, fontSize = (h6?.sizePx ?: 20.0).sp, fontWeight = weight(h6))
        Text("Cards pick up the paper background and border radius.", color = muted, style = MaterialTheme.typography.bodyMedium)
      }
      Column(Modifier.fillMaxWidth().background(color(kit.surfaceMain), shape).border(1.dp, color(kit.divider), shape).padding(space(1.5f))) {
        Text("Surface", color = color(kit.surfaceContrastText, ink), style = MaterialTheme.typography.titleSmall)
        Text("Raised panels and toolbars sit on the surface color.", color = color(kit.surfaceContrastText, ink), style = MaterialTheme.typography.bodyMedium)
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Tile("Primary", kit.tintPrimary, kit.primary.dark, shape, ::color, Modifier.weight(1f))
        Tile("Secondary", kit.tintSecondary, kit.secondary.main, shape, ::color, Modifier.weight(1f))
        Tile("Tertiary", kit.tintTertiary, kit.tertiary.main, shape, ::color, Modifier.weight(1f))
      }
      Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Text("Error", color = color(kit.error.main), style = MaterialTheme.typography.bodySmall)
        Text("Invalid", Modifier.fillMaxWidth().border(1.dp, color(kit.error.main), shape).padding(space(1f)), color = ink)
        Text("Field errors use the error color.", color = color(kit.error.main), style = MaterialTheme.typography.bodySmall)
      }
      listOf("Success" to kit.success, "Info" to kit.info, "Warning" to kit.warning, "Error" to kit.error).forEach { (label, accent) ->
        Text("$label alert uses the palette.", Modifier.fillMaxWidth().border(1.dp, color(accent.main), shape).padding(space(1.5f)), color = color(accent.dark), style = MaterialTheme.typography.bodyMedium)
      }
      Column {
        Column(Modifier.fillMaxWidth().background(color(kit.selected)).padding(space(1f))) {
          Text("Selected list row", color = ink)
          Text("Selection uses the palette's action colors.", color = muted, style = MaterialTheme.typography.bodySmall)
        }
        Text("Unselected list row", Modifier.padding(space(1f)), color = ink)
      }
    }
  }
}

@Composable
private fun Filled(label: String, accent: ThemePreviewAccent, shape: RoundedCornerShape, color: (String, Color) -> Color) {
  Text(
    label,
    Modifier.background(color(accent.main, Color.Transparent), shape).padding(horizontal = space(1.5f), vertical = space(1f)),
    color = color(accent.contrastText, Color.Unspecified),
    style = MaterialTheme.typography.labelLarge,
  )
}

@Composable
private fun Tile(label: String, fill: String, ink: String, shape: RoundedCornerShape, color: (String, Color) -> Color, modifier: Modifier) {
  Column(modifier.background(color(fill, Color.Transparent), shape).padding(space(1.5f))) {
    Text(label, color = color(ink, Color.Unspecified), style = MaterialTheme.typography.titleSmall)
    Text("tint.${label.lowercase()}", color = color(ink, Color.Unspecified), style = MaterialTheme.typography.bodySmall)
  }
}
