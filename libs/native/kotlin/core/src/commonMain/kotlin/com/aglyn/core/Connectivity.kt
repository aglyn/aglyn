package com.aglyn.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Whether the device has a network connection (the console's `useOnlineStatus`, AGL-1056): the shell says "Offline" while it
 * has none, so nobody keeps editing while every write quietly fails. A platform without a way to tell reads as online.
 */
interface Connectivity {
  val online: StateFlow<Boolean>
}

/** A platform that cannot tell: always online, so the indicator never shows. */
object AlwaysOnline : Connectivity {
  override val online: StateFlow<Boolean> = MutableStateFlow(true)
}

/** The console's words for the indicator's tooltip. */
const val OFFLINE_DETAIL = "Your device has lost its network connection. Changes you make now cannot be saved until it comes back."
