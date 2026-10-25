// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import AglynUI
import Foundation
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif
#if canImport(UserNotifications)
  import UserNotifications
#endif

/*
 * TAP TO PAY ON IPHONE AT THE REGISTER, as Apple's review asks for it
 * (requirements 1.5, 3.7, 4.2, 5.1 to 5.3, 5.7, 5.12). The rules are
 * AglynHardware's `TapToPay.swift`; this file wires them to the register:
 *
 * - The reader gets ready on its own when the register opens and whenever the
 *   app comes back to the front (`warmUpReader`).
 * - Checkout pins one "Tap to Pay on iPhone" button at its top on an iPhone,
 *   never greyed out. A press takes the card when the reader is ready,
 *   connects it first when it is not, waits out a setup already under way
 *   with its progress, or says why not (iOS too old; the platform's link with
 *   Apple missing: "contact support").
 * - Apple's merchant education opens right after Apple's terms are accepted.
 * - A card not approved while the app was not on screen is notified.
 */

extension RegisterModel {
  /// The pinned "Tap to Pay on iPhone" button: on a device whose own reader can take Tap to Pay (an iPhone).
  var offersTapToPay: Bool { collector?.kinds.contains(.tapToPay) == true }

  /// Whether this device's connected reader is Tap to Pay on iPhone.
  var deviceIsTapToPay: Bool {
    if case .connected(_, .tapToPay, _) = collector?.state { return true }
    return false
  }

  /// What a press of the button does right now.
  var tapToPayPressNow: TapToPayPress {
    guard let collector else { return .explain(.failed("This device cannot take Tap to Pay on iPhone.")) }
    let connecting: Bool = {
      if case .connecting = collector.state { return true }
      return false
    }()
    return tapToPayPress(
      osMajor: ProcessInfo.processInfo.operatingSystemVersion.majorVersion, state: collector.state,
      progress: connecting ? collector.deviceReaders?.update?.progress : nil,
      notice: collector.deviceReaders?.tapToPayNotice)
  }

  /// Gets the reader ready without asking for anything (Apple 1.5): when the register opens and whenever the app
  /// comes back to the front.
  func warmUpReader() async {
    guard let controls = collector?.deviceReaders, collector?.state.isConnected == false else { return }
    await controls.warmUp(hostID: hostID, sessions: terminal)
  }

  /// Lets Aglyn staff, and nobody else, accept Apple's terms on this device.
  func permitTapToPayTerms(isStaff: Bool) {
    collector?.deviceReaders?.permitTapToPayTerms(tapToPayTermsPermitted(isStaff: isStaff))
  }

  /// Gets Tap to Pay on iPhone ready for a press: nil once it is, else why not. A setup already under way is waited
  /// out (up to two minutes); a reader not yet connected is connected.
  func readyTapToPay() async -> TapToPayNotice? {
    guard let collector else { return .failed("This device cannot take Tap to Pay on iPhone.") }
    let tooLong = TapToPayNotice.failed("Tap to Pay on iPhone could not get ready. Keep the app open and try again.")
    for _ in 0..<600 {
      if Task.isCancelled { return tooLong }
      switch tapToPayPressNow {
      case .collect:
        return nil
      case .explain(.preparing):
        try? await Task.sleep(for: .milliseconds(200))
      case .explain(let notice):
        return notice
      case .connect:
        _ = await collector.connect(hostID: hostID, kind: .tapToPay, sessions: terminal)
        if deviceIsTapToPay { return nil }
        return collector.deviceReaders?.tapToPayNotice ?? tooLong
      }
    }
    return tooLong
  }
}

/// Posts a local notification for a card not approved while the app was not on screen (Apple 5.12). The permission
/// is asked for when Tap to Pay on iPhone is set up, well before a sale.
@MainActor
enum PosCardNotifier {
  static func notifyIfAway(_ note: CardNotApprovedNotification) {
    #if os(iOS) && canImport(UserNotifications)
      guard UIApplication.shared.applicationState != .active else { return }
      let content = UNMutableNotificationContent()
      content.title = note.title
      content.body = note.body
      content.sound = .default
      let request = UNNotificationRequest(identifier: "pos-card-not-approved-\(UUID().uuidString)", content: content, trigger: nil)
      UNUserNotificationCenter.current().add(request)
    #endif
  }

  /// Asks once, when a person sets up Tap to Pay on iPhone, whether the app may tell them about such a card.
  static func askPermission() async {
    #if canImport(UserNotifications)
      #if DEBUG
        if UserDefaults.standard.bool(forKey: "AglynNoPushPrompt") { return }
      #endif
      _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    #endif
  }
}

/// The pinned button at the top of checkout: Apple's name and symbol, the amount, never greyed out (Apple 5.1 to 5.5).
struct TapToPayCheckoutButton: View {
  let model: RegisterModel
  let checkout: Checkout
  @State private var preparing = false
  @State private var pending: Task<Void, Never>?
  @State private var notice: TapToPayNotice?

  var body: some View {
    Button(action: press) {
      HStack {
        Label(TapToPayIPhone.title, systemImage: TapToPayIPhone.symbol)
        Spacer()
        Text(model.money(checkout.amountCents + checkout.tipCents)).monospacedDigit()
      }
      .font(AglynFont.headline)
      .padding(.vertical, AglynSpace.one)
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.aglynProminent)
    .controlSize(.large)
    .accessibilityIdentifier("tender-tap-to-pay")
    .sheet(isPresented: $preparing) {
      TapToPayPreparingSheet(model: model) {
        pending?.cancel()
        preparing = false
      }
    }
    .alert(
      notice?.title ?? TapToPayIPhone.title, isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })
    ) {
      Button("OK", role: .cancel) { notice = nil }
    } message: {
      Text(notice?.message ?? "")
    }
  }

  /// Never greyed out: a press always does something, or says why not.
  private func press() {
    guard pending == nil, checkout.canTender, let device = model.deviceService else { return }
    switch model.tapToPayPressNow {
    case .collect:
      pending = Task {
        await checkout.payCard(device)
        pending = nil
      }
    case .explain(let why) where !isPreparing(why):
      notice = why
    default:
      preparing = true
      pending = Task {
        let why = await model.readyTapToPay()
        let canceled = Task.isCancelled
        preparing = false
        pending = nil
        guard !canceled else { return }
        if let why { notice = why } else { await checkout.payCard(device) }
      }
    }
  }

  private func isPreparing(_ notice: TapToPayNotice) -> Bool {
    if case .preparing = notice { return true }
    return false
  }
}

/// While the iPhone is being set up to take cards (Apple 3.9.1, 5.7): its progress, and another way to pay.
struct TapToPayPreparingSheet: View {
  let model: RegisterModel
  let payAnotherWay: () -> Void

  private var progress: Double? {
    if case .explain(.preparing(let progress)) = model.tapToPayPressNow { return progress }
    return nil
  }

  var body: some View {
    VStack(spacing: AglynSpace.two) {
      Image(systemName: TapToPayIPhone.symbol)
        .font(.largeTitle)
        .foregroundStyle(.tint)
      Text(TapToPayNotice.preparing(progress: progress).title)
        .font(AglynFont.headline)
        .multilineTextAlignment(.center)
      if let progress {
        ProgressView(value: progress)
      } else {
        ProgressView()
      }
      Text(TapToPayNotice.preparing(progress: progress).message)
        .font(AglynFont.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Button("Pay another way", action: payAnotherWay)
        .buttonStyle(.aglynSecondary)
        .controlSize(.large)
        .frame(maxWidth: .infinity)
    }
    .padding(AglynSpace.three)
    .presentationDetents([.medium])
    .interactiveDismissDisabled()
    .accessibilityIdentifier("tap-to-pay-preparing")
  }
}

/// Opens Apple's merchant education once Apple's terms were accepted on this device (Apple 4.2).
struct TapToPayEducationAfterTerms: ViewModifier {
  let collector: CardCollector?

  func body(content: Content) -> some View {
    content.task(id: collector?.deviceReaders?.tapToPayTermsJustAccepted == true) {
      guard let controls = collector?.deviceReaders, controls.tapToPayTermsJustAccepted else { return }
      controls.clearTapToPayTermsJustAccepted()
      #if os(iOS) && canImport(ProximityReader)
        await TapToPayEducation.present()
      #endif
    }
  }
}

extension View {
  func tapToPayEducationAfterTerms(_ collector: CardCollector?) -> some View {
    modifier(TapToPayEducationAfterTerms(collector: collector))
  }
}

// MARK: Payments setup on the iPhone (Apple 2.1 to 2.3, 3.4)

/// The console's own payments setup route: the store owner's Stripe account and the Stripe page that finishes it.
let commerceConnectRoute = "/api/commerce/connect"

/// Setting up payments from the app, through the SAME route and Stripe-hosted onboarding the console uses. The page
/// opens in the secure browser (a provider's account step, never a web view of ours); only the store's owner may
/// set payments up, and anyone else reads the route's own words.
struct PaymentsSetupAPI {
  let api: ConsoleAPIClient
  let hostID: String

  /// The Stripe page that finishes payments setup, or nil when payments are already set up.
  func setupPage() async throws -> URL? {
    let answer = try await api.request(commerceConnectRoute, method: .post, body: ["hostId": .string(hostID)])
    guard let text = answer?["url"]?.stringValue, let url = URL(string: text), url.scheme == "https" else { return nil }
    return url
  }
}

/// After payments are set up on this iPhone: the way to turn on Tap to Pay on iPhone, at once (Apple 3.4).
struct TapToPayEnableSheet: View {
  let setUp: () -> Void
  let notNow: () -> Void

  var body: some View {
    VStack(spacing: AglynSpace.two) {
      Image(systemName: TapToPayIPhone.symbol)
        .font(.largeTitle)
        .foregroundStyle(.tint)
      Text("Payments are set up. Turn on \(TapToPayIPhone.title)")
        .font(AglynFont.title3)
        .multilineTextAlignment(.center)
      Text("Customers tap a contactless card, phone or watch on this iPhone. Set it up now, so it is ready before the first sale.")
        .font(AglynFont.body)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Button("Set up \(TapToPayIPhone.title)", action: setUp)
        .buttonStyle(.aglynProminent)
        .controlSize(.large)
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("tap-to-pay-enable")
      Button("Not now", action: notNow)
        .buttonStyle(.aglynSecondary)
        .controlSize(.large)
        .frame(maxWidth: .infinity)
    }
    .padding(AglynSpace.three)
    .presentationDetents([.medium])
    .accessibilityIdentifier("tap-to-pay-enable-sheet")
  }
}
