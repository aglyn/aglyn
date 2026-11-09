package com.aglyn.pluginhost

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/*
 * THE CUSTOMER DISPLAY SEAM (AGL-4042), as core's plugin-customer-display has it in the console: a register with a
 * connected customer display registers itself while it can show something, and any plugin's widget on that screen asks
 * for it and hands it a screen, one of the asking plugin's own public console pages (`/kiosk/{pluginId}{path}`) with a
 * few short parameters. Neither side names the other plugin. The paired display is the authorization: the page reads
 * the display's own credential, never anything minted here. The Apple kit's CustomerDisplay.swift.
 */

/** What a plugin asks a paired display to show: its public page's path beneath `/kiosk/{pluginId}`, and a few plain parameters. */
data class CustomerDisplayScreen(val pluginId: String, val path: String, val params: Map<String, String> = emptyMap())

/** What a register with a connected display offers. */
class CustomerDisplayHost(
  /** Puts a plugin's screen on the display; false when it could not. */
  val show: suspend (CustomerDisplayScreen) -> Boolean,
  /** Takes a plugin's own screen off the display, only while it is the one showing. */
  val close: suspend (pluginId: String) -> Unit,
)

/** The register's display while it has one to show things on; null otherwise. */
object CustomerDisplayHosts {
  var current: CustomerDisplayHost? by mutableStateOf(null)
    private set
  private var token = 0

  /** Registers a host; the returned call withdraws it, only while it is still the current one. */
  fun register(host: CustomerDisplayHost): () -> Unit {
    val mine = ++token
    current = host
    return { if (token == mine) current = null }
  }
}
