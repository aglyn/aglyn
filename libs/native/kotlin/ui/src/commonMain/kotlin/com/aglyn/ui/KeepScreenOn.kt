package com.aglyn.ui

import androidx.compose.runtime.Composable

/*
 * KEEP THE SCREEN ON. A tablet set up as the customer display or the
 * self-service kiosk sits untouched for minutes and must not dim or lock
 * while it is on screen: nobody is there to wake it. The Apple apps do the
 * same with `isIdleTimerDisabled`.
 *
 * Put it in the composition of a screen that needs it; the screen may sleep
 * again as soon as the screen leaves composition. On Android it holds the
 * window's FLAG_KEEP_SCREEN_ON through the host view; on the desktop it does
 * nothing, because a desktop window is kept awake by the person at it.
 */
@Composable
expect fun KeepScreenOn(enabled: Boolean = true)
