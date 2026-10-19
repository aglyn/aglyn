package com.aglyn.shell

/** Whether the app runs on macOS, where shortcuts take ⌘ (Ctrl everywhere else). */
internal expect val isMacPlatform: Boolean

/** Whether the window has a menu bar whose shortcuts reach the shell as commands (the desktop), not as key events. */
internal expect val hasMenuBar: Boolean

/** Whether the app sets its own text size (the desktop); phones and tablets follow the system's. */
internal expect val appSetsTextSize: Boolean

/** Whether the shell takes the Compact (pointer) sizes on wide windows: the desktop; tablets take Touch sizes. */
internal expect val usesCompactChrome: Boolean

/**
 * The platform's [usesCompactChrome], as a local a test can set: the desktop test run renders the tablet's Touch shell with it
 * (NavFakeShots), so Touch sizes are measured off a device too.
 */
internal val LocalUsesCompactChrome = androidx.compose.runtime.staticCompositionLocalOf { usesCompactChrome }
