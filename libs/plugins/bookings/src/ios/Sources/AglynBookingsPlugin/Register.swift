// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

public let bookingsCalendarScreen = "bookings.calendar"
public let bookingScreen = "bookings.booking"
public let bookingsServicesScreen = "bookings.services"
public let bookingsCounterScreen = "bookings.counter"

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: in Aglyn, the site's bookings on a calendar with
/// each booking's check-in, reschedule, cancel and refund, the services and
/// their hours, Home's card for today, and the console's Bookings page
/// opening natively from a link or a notification; in Aglyn POS, today's
/// bookings paid at the counter. The Kotlin registrar is the same list.
@MainActor
public func registerBookingsNative(_ r: NativePluginRegistrar) {
  r.screen(bookingsCalendarScreen, title: "Bookings", requiresSite: true, icon: "calendar") { ctx, params in
    BookingsCalendarScreen(context: ctx, params: params)
  }
  r.screen(bookingScreen, title: "Booking", requiresSite: true, apps: [.aglyn, .pos], icon: "calendar") { ctx, params in
    BookingScreen(context: ctx, params: params)
  }
  r.screen(bookingsServicesScreen, title: "Services", requiresSite: true, icon: "list.bullet.rectangle") { ctx, _ in
    BookingServicesScreen(context: ctx)
  }
  r.screen(bookingsCounterScreen, title: "Today's bookings", requiresSite: true, apps: [.pos], icon: "calendar", placement: .menu) {
    ctx, _ in
    CounterBookingsScreen(context: ctx)
  }
  r.widget("bookings.today", title: "Today's bookings", icon: "calendar", order: 300, size: .half, requiresSite: true) {
    BookingsTodayWidget(context: $0)
  }
  r.quickAction("bookings.open", title: "Bookings", icon: "calendar", order: 300, screen: bookingsCalendarScreen, requiresSite: true)
  r.deepLink("bookings.page", path: "/bookings", screen: bookingsCalendarScreen)
}
