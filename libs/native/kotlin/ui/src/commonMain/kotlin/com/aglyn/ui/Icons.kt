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
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.automirrored.outlined.Launch
import androidx.compose.material.icons.automirrored.outlined.Logout
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
    "chevron_right" to Icons.AutoMirrored.Outlined.KeyboardArrowRight,
    "description" to Icons.Outlined.Description,
    "photo_library" to Icons.Outlined.PhotoLibrary,
    "insights" to Icons.Outlined.Insights,
    "receipt" to Icons.Outlined.ReceiptLong,
    "event" to Icons.Outlined.Event,
    "inbox" to Icons.Outlined.Inbox,
    "group" to Icons.Outlined.Group,
    "credit_card" to Icons.Outlined.CreditCard,
    "campaign" to Icons.Outlined.Campaign,
    "support" to Icons.Outlined.SupportAgent,
    "star" to Icons.Outlined.StarOutline,
    "auto_awesome" to Icons.Outlined.AutoAwesome,
    "task" to Icons.Outlined.TaskAlt,
    "inventory" to Icons.Outlined.Inventory2,
    "person" to Icons.Outlined.PersonOutline,
    "shield" to Icons.Outlined.Shield,
    "warning" to Icons.Outlined.WarningAmber,
    "info" to Icons.Outlined.Info,
    "logout" to Icons.AutoMirrored.Outlined.Logout,
    "launch" to Icons.AutoMirrored.Outlined.Launch,
  )

  fun named(name: String?): ImageVector = byName[name] ?: Icons.Outlined.Extension
}
