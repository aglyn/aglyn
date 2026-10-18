package com.aglyn.ui

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * A pushed screen's own title, once its data names it (an AI job's brief, a record's name), which the shell's top bar
 * shows in place of the screen's registered title. Null keeps the registered one; the shell provides a fresh state per
 * pushed screen, so a title never outlives its screen.
 */
val LocalScreenTitle = staticCompositionLocalOf<MutableState<String?>?> { null }
