package com.aglyn.shell

import com.aglyn.ui.sheetEntrance
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.AppAppearance
import com.aglyn.contracts.AppDensity
import com.aglyn.contracts.AppSidebarStyle
import com.aglyn.contracts.AppTextSize
import com.aglyn.contracts.AppThemeName
import com.aglyn.contracts.AppThemePrefs
import com.aglyn.contracts.Contracts
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynLightColorScheme
import com.aglyn.ui.SettingsDivider
import com.aglyn.ui.SettingsGroup
import com.aglyn.ui.SettingsRow
import com.aglyn.ui.SettingsTrailing
import com.aglyn.ui.TextButton
import com.aglyn.ui.colorOfHex
import com.aglyn.ui.contrastRatio
import com.aglyn.ui.deriveAccent
import com.aglyn.ui.space
import com.aglyn.ui.themeAccentSeed
import com.aglyn.ui.themeSurfaces
import com.aglyn.ui.toHex

/** A theme's name as the contract words it; the brand's own theme (Aglyn's, `brandLabel`) takes the build's brand name. */
internal fun themeLabel(theme: AppThemeName, brandName: String): String =
  com.aglyn.contracts.themePalette(theme.raw).let { if (it.brandLabel == true || it.label.isBlank()) brandName else it.label }

internal fun densityLabel(density: AppDensity) = if (density == AppDensity.COMPACT) "Compact" else "Comfortable"

internal fun textSizeLabel(size: AppTextSize) = when (size) {
  AppTextSize.SMALL -> "Small"
  AppTextSize.MEDIUM -> "Medium"
  AppTextSize.LARGE -> "Large"
  AppTextSize.EXTRA_LARGE -> "Extra large"
  else -> "Match system"
}

internal fun sidebarLabel(style: AppSidebarStyle) = if (style == AppSidebarStyle.PLAIN) "Plain" else "Tinted"

/**
 * The Theme settings (account menu ▸ Theme, Settings ▸ Theme): appearance, theme, accent, density, text size (desktop),
 * sidebar, whether each workspace's brand tints the app, each workspace's color, and whether all this is this device's
 * own. Every change applies at once.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ThemeSettingsScreen(services: ShellServices, workspace: WorkspaceState, onWorkspaceColor: (String) -> Unit) {
  val prefs by services.accountPrefs.state.collectAsState()
  val theme = prefs.theme
  val deviceOnly = prefs.deviceTheme != null
  fun save(next: AppThemePrefs) = services.accountPrefs.setTheme(next, deviceOnly)
  var customAccent by remember { mutableStateOf(false) }

  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = space(1f)).testTag("theme-settings")) {
    Text(
      if (deviceOnly) "Set on this device only" else "Saved on your account",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.padding(horizontal = space(2.5f)),
    )
    SettingsGroup("Appearance") {
      Choice(Contracts.appAppearances, theme.appearance, { appearanceLabel(it) }, "theme-appearance") { save(theme.copy(appearance = it)) }
    }
    SettingsGroup("Theme", footer = if (theme.theme == AppThemeName.NIGHT) "Night is dark whatever the appearance says." else null) {
      FlowRow(Modifier.fillMaxWidth().padding(space(1.5f)), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (name in Contracts.appThemeNames) {
          ThemeTile(name, themeLabel(name, services.config.brandName), selected = theme.theme == name) { save(theme.copy(theme = name)) }
        }
      }
    }
    SettingsGroup("Accent", footer = "Hover, pressed, selected and text-on-accent are worked out for you; a hard-to-read color is nudged until it passes.") {
      Row(Modifier.fillMaxWidth().padding(space(1.5f)), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        for (swatch in Contracts.themeAccentSwatches) {
          Swatch(swatch.label, com.aglyn.ui.themeColor(swatch.color), theme.accent.equals(swatch.color, ignoreCase = true), "accent-${swatch.id}") {
            save(theme.copy(accent = swatch.color.uppercase()))
          }
        }
        TextButton(onClick = { customAccent = true }, modifier = Modifier.testTag("accent-custom")) { Text("Custom…") }
      }
      if (theme.accent != "theme") {
        TextButton(onClick = { save(theme.copy(accent = "theme")) }, modifier = Modifier.padding(start = space(1f)).testTag("accent-theme")) {
          Text("Use ${themeLabel(theme.theme, services.config.brandName)}'s own accent")
        }
      }
    }
    SettingsGroup("Layout") {
      SettingsRow("Density", description = "Compact fits more rows on screen")
      Choice(Contracts.appDensities, theme.density, ::densityLabel, "theme-density") { save(theme.copy(density = it)) }
      SettingsDivider()
      SettingsRow("Sidebar", description = "Tinted wears the workspace's color")
      Choice(Contracts.appSidebarStyles, theme.sidebarStyle, ::sidebarLabel, "theme-sidebar") { save(theme.copy(sidebarStyle = it)) }
      SettingsDivider()
      if (appSetsTextSize) {
        SettingsRow("Text size")
        Choice(Contracts.appTextSizes, theme.textSize, ::textSizeLabel, "theme-text-size") { save(theme.copy(textSize = it)) }
      } else {
        SettingsRow("Text size", description = "Follows your device's text size", trailing = SettingsTrailing.Status("Match system"))
      }
    }
    services.appIcons?.let { icons ->
      SettingsGroup("App icon", footer = "The icon on your home screen. It changes when you leave the app; some launchers take a moment to show it.") {
        val current = icons.choices.firstOrNull { it.id == theme.appIcon } ?: icons.choices.first()
        Choice(icons.choices, current, { it.label }, "theme-app-icon") { choice ->
          save(theme.copy(appIcon = choice.id))
          icons.apply(choice.id)
        }
      }
    }
    SettingsGroup("Workspaces") {
      SettingsRow(
        "Use each workspace's brand",
        description = "Its brand color tints the app while you are in it",
        trailing = SettingsTrailing.Toggle(theme.useWorkspaceBrand, { save(theme.copy(useWorkspaceBrand = it)) }),
        modifier = Modifier.testTag("theme-use-brand"),
      )
      for (org in workspace.orgs.take(8)) {
        SettingsDivider()
        val color = colorOfHex(prefs.workspaceColors[org.id] ?: workspace.orgLogos[org.id]?.brandColor)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          Box(Modifier.weight(1f)) {
            SettingsRow(
              org.name,
              description = if (prefs.workspaceColors[org.id] != null) "Your color" else if (color != null) "Its brand color" else "No color yet",
              trailing = SettingsTrailing.Opens(),
              onClick = { onWorkspaceColor(org.id) },
              modifier = Modifier.testTag("theme-workspace-${org.id}"),
            )
          }
        }
      }
    }
    SettingsGroup(null) {
      SettingsRow(
        "Apply to this device only",
        description = if (deviceOnly) "Your account's theme stays as it was" else "Off: the theme follows you to every device",
        trailing = SettingsTrailing.Toggle(deviceOnly, { only -> services.accountPrefs.setTheme(theme, deviceOnly = only) }),
        modifier = Modifier.testTag("theme-device-only"),
      )
    }
  }
  if (customAccent) CustomAccentDialog(theme.accent.takeIf { it.startsWith("#") }) { picked ->
    customAccent = false
    picked?.let { save(theme.copy(accent = it)) }
  }
}

@Composable
private fun <T> Choice(options: List<T>, selected: T, label: (T) -> String, tag: String, onPick: (T) -> Unit) {
  SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = space(1.5f), vertical = space(1f)).testTag(tag)) {
    options.forEachIndexed { index, option ->
      SegmentedButton(
        selected = option == selected,
        onClick = { onPick(option) },
        shape = SegmentedButtonDefaults.itemShape(index, options.size),
        // The selected choice wears the accent's wash, not the secondary (pink) container.
        colors = SegmentedButtonDefaults.colors(
          activeContainerColor = MaterialTheme.colorScheme.primaryContainer,
          activeContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
        modifier = Modifier.testTag("$tag-$index"),
        label = { Text(label(option), maxLines = 1, overflow = TextOverflow.Ellipsis) },
      )
    }
  }
}

/** A theme's preview: its rail, its page, a row and its accent, light, with the name under it. */
@Composable
private fun ThemeTile(name: AppThemeName, label: String, selected: Boolean, onClick: () -> Unit) {
  val surfaces = themeSurfaces(name, dark = name == AppThemeName.NIGHT)
  val rail = surfaces?.rail ?: AglynLightColorScheme.surfaceContainerHigh
  val page = surfaces?.canvas ?: AglynLightColorScheme.background
  val card = surfaces?.surface ?: AglynLightColorScheme.surfaceContainerLowest
  val line = surfaces?.borderSubtle ?: AglynLightColorScheme.outlineVariant
  val accent = deriveAccent(themeAccentSeed(name), dark = false).fill
  val ring = MaterialTheme.colorScheme.primary
  Column(
    Modifier.width(112.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)
      .semantics(mergeDescendants = true) { role = Role.RadioButton; this.selected = selected }
      .testTag("theme-${name.raw}"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Row(
      Modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(10.dp))
        .border(if (selected) 2.dp else 1.dp, if (selected) ring else line, RoundedCornerShape(10.dp)).background(page),
    ) {
      Box(Modifier.width(18.dp).fillMaxHeight().background(rail))
      Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(4.dp)).background(card))
        Box(Modifier.width(36.dp).height(10.dp).clip(RoundedCornerShape(4.dp)).background(accent))
      }
    }
    Text(label, style = MaterialTheme.typography.labelLarge)
  }
}

@Composable
private fun Swatch(name: String, color: Color, selected: Boolean, tag: String, onClick: () -> Unit) {
  val ring = MaterialTheme.colorScheme.onSurface
  Box(
    Modifier.size(32.dp).clip(CircleShape).clickable(onClick = onClick)
      .then(if (selected) Modifier.border(2.dp, ring, CircleShape) else Modifier)
      .padding(if (selected) 4.dp else 0.dp).clip(CircleShape).background(color)
      .semantics { contentDescription = name; role = Role.RadioButton; this.selected = selected }
      .testTag(tag),
    contentAlignment = Alignment.Center,
  ) {
    if (selected) Icon(AglynIcons.named("check"), null, Modifier.size(14.dp), tint = if (contrastRatio(Color.White, color) >= 3f) Color.White else Color.Black)
  }
}

/** Custom accent: a `#RRGGBB`, shown as it will be worked out (the fill a button wears and its text). */
@Composable
private fun CustomAccentDialog(initial: String?, onDone: (String?) -> Unit) {
  var text by remember { mutableStateOf(initial ?: "#") }
  val color = colorOfHex(text.trim())
  AlertDialog(
    onDismissRequest = { onDone(null) },
    modifier = Modifier.widthIn(max = 420.dp).sheetEntrance(com.aglyn.ui.SheetEntrance.GROW).testTag("accent-custom-dialog"),
    title = { Text("Custom accent") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(text, { text = it }, label = { Text("Color") }, placeholder = { Text("#7A5CF0") }, singleLine = true, isError = text.length > 1 && color == null, modifier = Modifier.fillMaxWidth().testTag("accent-custom-field"))
        color?.let {
          val worked = deriveAccent(it, dark = false)
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.clip(RoundedCornerShape(8.dp)).background(worked.fill).padding(horizontal = 14.dp, vertical = 8.dp)) {
              Text("Button", color = worked.onFill, style = MaterialTheme.typography.labelLarge)
            }
            Text(if (worked.fill.toHex() == it.toHex()) "Reads well as it is." else "Darkened to ${worked.fill.toHex()} so text on it reads.", style = MaterialTheme.typography.bodySmall)
          }
        }
      }
    },
    confirmButton = { TextButton(enabled = color != null, onClick = { onDone(color?.toHex()) }, modifier = Modifier.testTag("accent-custom-save")) { Text("Use this color") } },
    dismissButton = { TextButton(onClick = { onDone(null) }) { Text("Cancel") } },
  )
}
