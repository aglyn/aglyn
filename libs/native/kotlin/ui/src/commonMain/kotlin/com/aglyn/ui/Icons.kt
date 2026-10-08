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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ClearAll
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Contactless
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Percent
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.ShoppingBasket
import androidx.compose.material.icons.outlined.Bluetooth
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.FlashlightOn
import androidx.compose.material.icons.outlined.FlashlightOff
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Sms
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.WifiOff
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
    "search" to Icons.Outlined.Search,
    "qr_code_scanner" to Icons.Outlined.QrCodeScanner,
    "add" to Icons.Outlined.Add,
    "remove" to Icons.Outlined.Remove,
    "delete" to Icons.Outlined.DeleteOutline,
    "shopping_basket" to Icons.Outlined.ShoppingBasket,
    "payments" to Icons.Outlined.Payments,
    "card_giftcard" to Icons.Outlined.CardGiftcard,
    "contactless" to Icons.Outlined.Contactless,
    "print" to Icons.Outlined.Print,
    "mail" to Icons.Outlined.MailOutline,
    "sms" to Icons.Outlined.Sms,
    "close" to Icons.Outlined.Close,
    "check" to Icons.Outlined.Check,
    "keyboard" to Icons.Outlined.Keyboard,
    "sell" to Icons.Outlined.Sell,
    "percent" to Icons.Outlined.Percent,
    "history" to Icons.Outlined.History,
    "refresh" to Icons.Outlined.Refresh,
    "schedule" to Icons.Outlined.Schedule,
    "wifi_off" to Icons.Outlined.WifiOff,
    "more_vert" to Icons.Outlined.MoreVert,
    "pause" to Icons.Outlined.PauseCircle,
    "barcode" to Icons.Outlined.QrCodeScanner,
    "tune" to Icons.Outlined.Tune,
    "clear_all" to Icons.Outlined.ClearAll,
    "bookmark" to Icons.Outlined.BookmarkBorder,
    "bluetooth" to Icons.Outlined.Bluetooth,
    "photo_camera" to Icons.Outlined.PhotoCamera,
    "flashlight_on" to Icons.Outlined.FlashlightOn,
    "flashlight_off" to Icons.Outlined.FlashlightOff,
    "local_shipping" to Icons.Outlined.LocalShipping,
    "cancel" to Icons.Outlined.Cancel,
    "done_all" to Icons.Outlined.DoneAll,
    "location_on" to Icons.Outlined.LocationOn,
    "undo" to Icons.AutoMirrored.Outlined.Undo,
  )

  fun named(name: String?): ImageVector = byName[name] ?: CONTENT_ICONS[name] ?: Icons.Outlined.Extension
}
