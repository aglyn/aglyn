package com.aglyn.shell

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * The Aglyn app's home-screen icon by launcher activity aliases (AndroidManifest: `.LauncherAglyn`, `.LauncherLight`,
 * `.LauncherDark`, each pointing at the main activity): exactly one is enabled, without stopping the app.
 */
class LauncherIconSwitcher(private val context: Context) : AppIconSwitcher {
  override val choices: List<AppIconChoice> = APP_ICON_CHOICES

  private fun aliasOf(id: String) = ComponentName(context.packageName, "com.aglyn.app.Launcher" + id.replaceFirstChar { it.uppercase() })

  override fun current(): String {
    val pm = context.packageManager
    return choices.firstOrNull { choice ->
      when (pm.getComponentEnabledSetting(aliasOf(choice.id))) {
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
        // The manifest's default: the app's own alias is on until something turns it off.
        PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> choice.id == APP_ICON_CHOICES.first().id
        else -> false
      }
    }?.id ?: APP_ICON_CHOICES.first().id
  }

  override fun apply(id: String) {
    val target = choices.firstOrNull { it.id == id }?.id ?: choices.first().id
    if (target == current()) return
    val pm = context.packageManager
    // The new alias first, so the launcher always has one to show.
    pm.setComponentEnabledSetting(aliasOf(target), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
    for (choice in choices.filter { it.id != target }) {
      pm.setComponentEnabledSetting(aliasOf(choice.id), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
    }
  }
}
