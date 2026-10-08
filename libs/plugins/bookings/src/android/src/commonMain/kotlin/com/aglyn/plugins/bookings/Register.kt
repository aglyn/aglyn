package com.aglyn.plugins.bookings

import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.PosPlacement
import com.aglyn.pluginhost.WidgetSize

const val BOOKINGS_COUNTER_SCREEN = "bookings.counter"
const val BOOKINGS_CALENDAR_SCREEN = "bookings.calendar"
const val BOOKING_SCREEN = "bookings.booking"
const val SERVICES_SCREEN = "bookings.services"

/**
 * The Bookings plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. In Aglyn, the site's
 * bookings on a calendar with each booking's check-in, reschedule, cancel
 * and refund, the services and their hours, Home's card for today, and the
 * console's Bookings page opening natively from a link or a notification. In
 * Aglyn POS, today's bookings open from the register's menu and take payment
 * at the counter, and a booking opens with its own actions.
 */
fun registerBookingsNative(r: NativePluginRegistrar) {
  r.screen(BOOKINGS_CALENDAR_SCREEN, title = "Bookings", requiresSite = true, icon = "calendar_month") { context, params ->
    BookingsCalendarScreen(context, params)
  }
  r.screen(BOOKING_SCREEN, title = "Booking", requiresSite = true, apps = setOf(NativeApp.AGLYN, NativeApp.POS), icon = "event") { context, params ->
    BookingScreen(context, params)
  }
  r.screen(SERVICES_SCREEN, title = "Services", requiresSite = true, icon = "design_services") { context, _ ->
    BookingServicesScreen(context)
  }
  r.screen(
    BOOKINGS_COUNTER_SCREEN,
    title = "Today's bookings",
    requiresSite = true,
    apps = setOf(NativeApp.POS),
    icon = "event",
    placement = PosPlacement.MENU,
  ) { context, _ -> CounterBookingsScreen(context) }
  r.widget("bookings.today", title = "Today's bookings", order = 300, size = WidgetSize.HALF, requiresSite = true) { context ->
    BookingsTodayWidget(context)
  }
  r.quickAction("bookings.open", title = "Bookings", icon = "calendar_month", order = 300, requiresSite = true, screen = BOOKINGS_CALENDAR_SCREEN)
  r.deepLink("bookings.page", path = "/bookings", screen = BOOKINGS_CALENDAR_SCREEN)
}
