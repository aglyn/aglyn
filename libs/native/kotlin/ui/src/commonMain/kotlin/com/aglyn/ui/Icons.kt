package com.aglyn.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.AltRoute
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.PointOfSale
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material.icons.outlined.Web
import androidx.compose.material.icons.outlined.Workspaces
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Material Symbols names (as plugins declare them) to the Compose icon set.
 * An unknown name falls back to a neutral glyph rather than failing.
 */
object AglynIcons {
  private val byName: Map<String, ImageVector> = mapOf(
    "alt_route" to Icons.Outlined.AltRoute,
    "apps" to Icons.Outlined.Apps,
    "arrow_back" to Icons.AutoMirrored.Outlined.ArrowBack,
    "bolt" to Icons.Outlined.Bolt,
    "check_circle" to Icons.Outlined.CheckCircle,
    "dashboard" to Icons.Outlined.Dashboard,
    "error" to Icons.Outlined.ErrorOutline,
    "extension" to Icons.Outlined.Extension,
    "home" to Icons.Outlined.Home,
    "language" to Icons.Outlined.Language,
    "notifications" to Icons.Outlined.Notifications,
    "open_in_new" to Icons.AutoMirrored.Outlined.OpenInNew,
    "pause_circle" to Icons.Outlined.PauseCircle,
    "point_of_sale" to Icons.Outlined.PointOfSale,
    "public" to Icons.Outlined.Public,
    "settings" to Icons.Outlined.Settings,
    "storefront" to Icons.Outlined.Storefront,
    "swap_horiz" to Icons.Outlined.SwapHoriz,
    "web" to Icons.Outlined.Web,
    "workspaces" to Icons.Outlined.Workspaces,
  )

  fun named(name: String?): ImageVector = byName[name] ?: Icons.Outlined.Extension
}
