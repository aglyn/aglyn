package com.aglyn.shell

/** One home-screen icon the app can wear: its id as account preferences store it (`appIcon`), and its name. */
data class AppIconChoice(val id: String, val label: String)

/**
 * The logo kit's icons (tools/scripts/lib/native-alternate-icons.mjs): the app's own, and the colored mark on a white
 * and on the slate ground. Ids match the Apple app's, so the synced choice means the same icon on both.
 */
val APP_ICON_CHOICES = listOf(
  AppIconChoice("aglyn", "Aglyn"),
  AppIconChoice("light", "Aglyn Light"),
  AppIconChoice("dark", "Aglyn Dark"),
)

/** Puts an icon on the home screen. */
interface AppIconSwitcher {
  val choices: List<AppIconChoice>
  /** The icon on the home screen now. */
  fun current(): String
  /** Wears [id] (an unknown one is the app's own); a no-op when it already does. */
  fun apply(id: String)
}
