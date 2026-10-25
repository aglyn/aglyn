// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE CUSTOMER DISPLAY (AGL-3608), full screen on the tablet facing the customer.
 * The Kotlin app's `PosCustomerDisplay.kt`. The console's display page, native:
 * pairing by code, the store's idle and thank-you screens, the basket as the
 * cashier builds it, the tip prompt, the receipt prompt, and a processing screen
 * while a card waits on the reader. The customer's typed address lives in this
 * view only until it is sent; every screen is keyed by its prompt, so the next
 * customer finds nothing of the last one's.
 */

public let commerceDisplayScreen = "commerce.display"

struct PosCustomerDisplayScreen: View {
  let context: NativePluginContext
  @State private var model: PosCustomerDisplayModel

  init(context: NativePluginContext) {
    self.context = context
    _model = State(
      initialValue: PosCustomerDisplayModel(
        api: ConsolePosDeviceAPI(api: context.api), store: PosDeviceTokenStore(defaults: .standard, mode: .display)))
  }

  var body: some View {
    ZStack {
      AglynColor.page.ignoresSafeArea()
      if !model.started {
        ProgressView()
      } else if model.token == nil {
        PosDevicePairingView(
          mode: .display, busy: model.pairing, error: model.pairError,
          onPair: { code in Task { await model.pair(code: code) } }, onLeave: { context.back() })
      } else {
        VStack(spacing: 0) {
          if model.offline {
            AglynNotice("Reconnecting…", tone: .warning).padding(AglynSpace.one)
          }
          DisplayBody(model: model)
            .id("\(model.read?.state.mode.rawValue ?? "idle"):\(model.read?.state.promptId ?? "")")
        }
        .overlay(alignment: .bottomTrailing) { UnpairControl(model: model) }
      }
    }
    .task { model.start() }
    .task(id: model.token) {
      guard model.token != nil else { return }
      while !Task.isCancelled {
        await model.poll()
        try? await Task.sleep(for: model.pollDelay)
      }
    }
    #if os(iOS)
      // The screen faces a customer all day: it stays on while paired.
      .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
      .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    #endif
  }
}

/// The screen for the current mode.
private struct DisplayBody: View {
  let model: PosCustomerDisplayModel

  var body: some View {
    switch model.screen {
    case .idle:
      PosDeviceBrandScreen(branding: model.branding, title: nil, message: model.branding?.message ?? "Welcome")
    case .thanks:
      PosDeviceBrandScreen(branding: model.branding, title: "Thank you!", message: nil)
    case .processing(let message, let total):
      PosDeviceBrandScreen(
        branding: model.branding, title: message,
        message: total.map { "Total \(posMoney($0, currency: model.currency))" }, busy: true)
    case .answered:
      PosDeviceBrandScreen(branding: model.branding, title: "Thanks — the cashier will finish up", message: nil)
    case .cart(let cart):
      DeviceScroll(branding: model.branding, notice: model.notice) { DisplayCartView(cart: cart, currency: model.currency) }
    case .tip(let tip, let promptID):
      DeviceScroll(branding: model.branding, notice: model.notice) { DisplayTipView(
          tip: tip, currency: model.currency, busy: model.busy, promptID: promptID,
          onAnswer: { answer in Task { await model.answer(answer) } }) }
    case .receipt(let receipt, let promptID):
      DeviceScroll(branding: model.branding, notice: model.notice) { DisplayReceiptView(
          receipt: receipt, busy: model.busy, promptID: promptID, onAnswer: { answer in Task { await model.answer(answer) } }) }
    }
  }
}

/// A prompt's layout: the store's mark, the cashier-side notice, then the screen.
struct DeviceScroll<Content: View>: View {
  let branding: PosDeviceBranding?
  let notice: String?
  @ViewBuilder let content: Content

  var body: some View {
    ScrollView {
      VStack(spacing: AglynSpace.four) {
        PosDeviceBrandMark(branding: branding)
        if let notice { AglynNotice(notice, tone: .info) }
        content
      }
      .padding(AglynSpace.four)
      .frame(maxWidth: 720)
      .frame(maxWidth: .infinity)
    }
  }
}

/// The store's logo, or its name.
struct PosDeviceBrandMark: View {
  let branding: PosDeviceBranding?
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    if let url = (scheme == .dark ? branding?.logoDarkURL : nil) ?? branding?.logoURL {
      AglynRemoteImage(url, systemImage: "storefront", contentMode: .fit, label: branding?.name)
        .frame(maxHeight: 72)
    } else if let name = branding?.name, !name.isEmpty {
      Text(name).font(AglynFont.title2.weight(.semibold))
    }
  }
}

/// The idle, thank-you and processing screens: the store's mark and one line.
struct PosDeviceBrandScreen<Extra: View>: View {
  let branding: PosDeviceBranding?
  let title: String?
  let message: String?
  var busy = false
  @ViewBuilder let extra: Extra

  init(
    branding: PosDeviceBranding?, title: String?, message: String?, busy: Bool = false, @ViewBuilder extra: () -> Extra
  ) {
    self.branding = branding
    self.title = title
    self.message = message
    self.busy = busy
    self.extra = extra()
  }

  var body: some View {
    VStack(spacing: AglynSpace.three) {
      PosDeviceBrandMark(branding: branding).frame(maxHeight: 120)
      if let title { Text(title).font(AglynFont.largeTitle).multilineTextAlignment(.center) }
      if busy { ProgressView().controlSize(.large) }
      if let message { Text(message).font(AglynFont.title2).foregroundStyle(.secondary).multilineTextAlignment(.center) }
      extra
    }
    .padding(AglynSpace.four)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityElement(children: .combine)
  }
}

extension PosDeviceBrandScreen where Extra == EmptyView {
  init(branding: PosDeviceBranding?, title: String?, message: String?, busy: Bool = false) {
    self.init(branding: branding, title: title, message: message, busy: busy) { EmptyView() }
  }
}

/// The basket as the cashier builds it, with what is paid and still due.
///
/// `totalCents` is the SALE: a tip rides beside it and never inside it, and so do `paidCents` and `dueCents`.
/// Once a tip is on the sale the customer sees it as its own line and the total they are actually paying
/// under it, so the screen never reads short by the tip.
struct DisplayCartView: View {
  let cart: PosDisplayCart
  let currency: String?

  private func money(_ cents: Double) -> String { posMoney(Int(cents), currency: currency) }

  var body: some View {
    // The register prices tax when the cashier charges; until then the basket has no tax figure.
    let priced = cart.dueCents != nil
    let tip = cart.tipCents ?? 0
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      if cart.lines.isEmpty {
        Text("Your items will show here").font(AglynFont.title2).foregroundStyle(.secondary).frame(maxWidth: .infinity)
      }
      ForEach(Array(cart.lines.enumerated()), id: \.offset) { _, line in
        HStack(alignment: .firstTextBaseline) {
          VStack(alignment: .leading, spacing: 2) {
            Text("\(Int(line.quantity)) × \(line.name)").font(AglynFont.title2)
            if let label = line.variantLabel, !label.isEmpty {
              Text(label).font(AglynFont.body).foregroundStyle(.secondary)
            }
          }
          Spacer()
          Text(money(line.amountCents)).font(AglynFont.title2).monospacedDigit()
        }
        Divider()
      }
      totalRow("Subtotal", cart.itemsCents)
      if cart.discountCents > 0 { totalRow("Discount", cart.discountCents, negative: true) }
      if priced { totalRow("Tax", cart.taxCents) }
      Divider()
      if tip > 0 {
        totalRow("Total", cart.totalCents)
        totalRow("Tip", tip)
        totalRow("Total with tip", cart.totalCents + tip, strong: true)
      } else {
        totalRow("Total", cart.totalCents, strong: true)
      }
      if !priced {
        Text("Any tax is added when you pay.").font(AglynFont.body).foregroundStyle(.secondary)
      }
      if let paid = cart.paidCents, paid > 0 { totalRow("Paid", paid) }
      if let due = cart.dueCents, (cart.paidCents ?? 0) > 0 { totalRow("Due", due, strong: true) }
    }
    .accessibilityIdentifier("display-cart")
  }

  private func totalRow(_ label: String, _ cents: Double, negative: Bool = false, strong: Bool = false) -> some View {
    HStack(alignment: .firstTextBaseline) {
      Text(label).font(strong ? AglynFont.largeTitle : AglynFont.title2)
      Spacer()
      Text((negative ? "−" : "") + money(cents)).font(strong ? AglynFont.largeTitle : AglynFont.title2).monospacedDigit()
    }
  }
}

/// A tall, full-width touch target.
struct DeviceButtonStyle: ButtonStyle {
  var prominent = true

  /// The kiosk's and the customer display's big buttons wear the app's two button looks at a counter's size: prominent
  /// is `.aglynProminent`'s brand fill under white (pressed a shade deeper), secondary is `.aglynSecondary`'s paper with
  /// a border/strong outline and primary text. Never the accent's text shade as a fill.
  func makeBody(configuration: Configuration) -> some View {
    let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
    configuration.label
      .font(AglynFont.title2.weight(.semibold))
      .frame(maxWidth: .infinity, minHeight: 80)
      .foregroundStyle(prominent ? AglynColor.primaryContrast : AglynColor.textPrimary)
      .background(
        shape.fill(
          prominent
            ? (configuration.isPressed ? AglynColor.accent(\.pressed) : AglynColor.primary)
            : (configuration.isPressed ? AglynColor.sunken : AglynColor.paper)))
      .overlay { if !prominent { shape.strokeBorder(AglynColor.borderStrong, lineWidth: 1) } }
      .contentShape(shape)
  }
}

/// The tip prompt: the merchant's presets, each with the amount it comes to, a custom amount and no tip. The
/// server recomputes a percentage from the prompt it sent, so what is shown here is never what is charged.
struct DisplayTipView: View {
  let tip: PosDisplayStateTip
  let currency: String?
  let busy: Bool
  let promptID: String
  let onAnswer: (PosDisplayAnswer) -> Void
  @State private var custom: String?
  @State private var problem: String?

  private func money(_ cents: Double) -> String { posMoney(Int(cents), currency: currency) }

  var body: some View {
    if custom != nil {
      VStack(spacing: AglynSpace.three) {
        Text("Custom tip").font(AglynFont.largeTitle)
        TextField("", text: Binding(get: { custom ?? "" }, set: { custom = $0; problem = nil }), prompt: Text("0.00"))
          .font(AglynFont.largeTitle).multilineTextAlignment(.center)
          .textFieldStyle(.roundedBorder)
          #if os(iOS)
            .keyboardType(.decimalPad)
          #endif
          .accessibilityLabel("Tip amount")
          .accessibilityIdentifier("display-tip-custom")
        Text(problem ?? "Up to \(money(tip.baseCents))")
          .font(AglynFont.body).foregroundStyle(problem == nil ? Color.secondary : AglynColor.error)
        HStack(spacing: AglynSpace.two) {
          Button("Back") { custom = nil; problem = nil }.buttonStyle(DeviceButtonStyle(prominent: false)).disabled(busy)
          Button("Add tip") { submitCustom() }
            .buttonStyle(DeviceButtonStyle())
            .disabled(busy || (custom ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityIdentifier("display-tip-add")
        }
      }
    } else {
      VStack(spacing: AglynSpace.three) {
        Text("Add a tip?").font(AglynFont.largeTitle)
        Text("On \(money(tip.baseCents))").font(AglynFont.title2).foregroundStyle(.secondary)
        HStack(spacing: AglynSpace.two) {
          ForEach(tip.percentages, id: \.self) { percent in
            Button {
              onAnswer(PosDisplayAnswer(promptID: promptID, tipChoice: .percent, tipPercent: percent))
            } label: {
              VStack(spacing: 2) {
                Text("\(Int(percent))%")
                Text(money(Double(posTipFromPercent(Int(tip.baseCents), percent)))).font(AglynFont.body)
              }
            }
            .buttonStyle(DeviceButtonStyle())
            .disabled(busy)
            .accessibilityIdentifier("display-tip-\(Int(percent))")
          }
        }
        HStack(spacing: AglynSpace.two) {
          if tip.allowCustom {
            Button("Custom amount") { custom = "" }.buttonStyle(DeviceButtonStyle(prominent: false)).disabled(busy)
          }
          Button("No tip") {
            onAnswer(PosDisplayAnswer(promptID: promptID, tipChoice: PosDisplayResponseTipChoice.none))
          }
          .buttonStyle(DeviceButtonStyle(prominent: false)).disabled(busy)
          .accessibilityIdentifier("display-tip-none")
        }
      }
    }
  }

  private func submitCustom() {
    guard let cents = centsFromText(custom) else {
      problem = "Enter an amount, like 5 or 5.50."
      return
    }
    if let issue = posTipProblem(tipCents: Double(cents), amountCents: tip.baseCents) {
      problem = issue
      return
    }
    custom = nil
    problem = nil
    onAnswer(PosDisplayAnswer(promptID: promptID, tipChoice: .custom, tipCents: cents))
  }
}

/// The receipt prompt. The channels are the register's offer; email and text ask for an address on this screen, and the
/// marketing box is shown only when the store turned it on, unticked.
struct DisplayReceiptView: View {
  let receipt: PosDisplayStateReceipt
  let busy: Bool
  let promptID: String
  let onAnswer: (PosDisplayAnswer) -> Void
  @State private var entry: PosReceiptChannel?
  @State private var value = ""
  @State private var optIn = false
  @State private var problem: String?

  private func label(_ channel: PosReceiptChannel) -> String {
    switch channel {
    case .email: "Email"
    case .sms: "Text"
    case .print: "Print"
    default: "No receipt"
    }
  }

  var body: some View {
    if let entry {
      let email = entry == .email
      VStack(spacing: AglynSpace.three) {
        Text(email ? "Email receipt" : "Text receipt").font(AglynFont.largeTitle)
        TextField(email ? "Email" : "Mobile number", text: $value.onChange { problem = nil })
          .font(AglynFont.title2).textFieldStyle(.roundedBorder).autocorrectionDisabled()
          #if os(iOS)
            .keyboardType(email ? .emailAddress : .phonePad)
            .textInputAutocapitalization(.never)
          #endif
          .accessibilityIdentifier("display-receipt-value")
        Text(problem ?? (email ? "For your receipt" : "For your receipt by text"))
          .font(AglynFont.body).foregroundStyle(problem == nil ? Color.secondary : AglynColor.error)
        if email, receipt.offerMarketing {
          Toggle("Email me news and offers", isOn: $optIn).font(AglynFont.title2)
        }
        HStack(spacing: AglynSpace.two) {
          Button("Back") { reset() }.buttonStyle(DeviceButtonStyle(prominent: false)).disabled(busy)
          Button("Send") { submit(email: email) }
            .buttonStyle(DeviceButtonStyle())
            .disabled(busy || value.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityIdentifier("display-receipt-send")
        }
      }
    } else {
      VStack(spacing: AglynSpace.three) {
        Text("How would you like your receipt?").font(AglynFont.largeTitle).multilineTextAlignment(.center)
        ForEach(receipt.channels, id: \.self) { channel in
          Button(label(channel)) {
            if channel == .email || channel == .sms {
              entry = channel
            } else {
              onAnswer(PosDisplayAnswer(promptID: promptID, receiptChannel: channel))
            }
          }
          .buttonStyle(DeviceButtonStyle(prominent: channel != .none))
          .disabled(busy)
          .accessibilityIdentifier("display-receipt-\(channel.rawValue)")
        }
      }
    }
  }

  private func reset() {
    entry = nil
    value = ""
    optIn = false
    problem = nil
  }

  private func submit(email: Bool) {
    if email {
      let address = posDisplayEmail(value)
      guard !address.isEmpty else {
        problem = "Enter an email address, like name@example.com."
        return
      }
      let marketing = receipt.offerMarketing && optIn
      reset()
      onAnswer(PosDisplayAnswer(promptID: promptID, receiptChannel: .email, email: address, marketingOptIn: marketing ? true : nil))
    } else {
      let phone = posDisplayPhone(value)
      guard !phone.isEmpty else {
        problem = "Enter a phone number with its area code."
        return
      }
      reset()
      onAnswer(PosDisplayAnswer(promptID: promptID, receiptChannel: .sms, phone: phone))
    }
  }
}

private extension Binding where Value == String {
  /// Runs `change` whenever the text is edited.
  func onChange(_ change: @escaping () -> Void) -> Binding<String> {
    Binding(get: { wrappedValue }, set: { wrappedValue = $0; change() })
  }
}

/// Unpairing, tucked into a corner behind a confirmation: the person at the counter is a customer, and one stray tap
/// must not take the screen away.
private struct UnpairControl: View {
  let model: PosCustomerDisplayModel
  @State private var confirming = false

  var body: some View {
    Button("Unpair this display") { confirming = true }
      .font(AglynFont.caption).buttonStyle(.plain).foregroundStyle(.secondary).opacity(0.5)
      .padding(AglynSpace.one)
      .accessibilityIdentifier("display-unpair")
      .confirmationDialog("Unpair this display?", isPresented: $confirming, titleVisibility: .visible) {
        Button("Unpair", role: .destructive) { Task { await model.unpair() } }
      } message: {
        Text("It stops showing sales from the register. To use it again, enter a new code from the register.")
      }
  }
}

/// The unpaired screen: six digits from the register's pairing dialog, exchanged once for this device's token.
struct PosDevicePairingView: View {
  let mode: PosDeviceMode
  let busy: Bool
  let error: String?
  let onPair: (String) -> Void
  let onLeave: () -> Void
  @State private var code = ""

  private var noun: String { mode == .kiosk ? "kiosk" : "display" }

  var body: some View {
    VStack(spacing: AglynSpace.four) {
      Spacer(minLength: 0)
      Text("Pair this \(noun)").font(AglynFont.largeTitle)
      Text("Enter the code shown on the register").font(AglynFont.title2).foregroundStyle(.secondary)
      TextField("", text: $code, prompt: Text("000000"))
        .font(.system(size: 48, weight: .bold, design: .rounded)).multilineTextAlignment(.center).monospacedDigit()
        .textFieldStyle(.roundedBorder)
        .frame(maxWidth: 360)
        .autocorrectionDisabled()
        #if os(iOS)
          .keyboardType(.numberPad)
        #endif
        .onChange(of: code) { _, text in code = String(text.filter(\.isNumber).prefix(6)) }
        .onSubmit { onPair(code) }
        .accessibilityLabel("Pairing code")
        .accessibilityIdentifier("pairing-entry")
      if let error { AglynNotice(error, tone: .error).frame(maxWidth: 360) }
      Button(busy ? "Pairing…" : "Pair \(noun)") { onPair(code) }
        .buttonStyle(.aglynProminent).controlSize(.large)
        .disabled(code.count != 6 || busy)
        .accessibilityIdentifier("pairing-submit")
      Spacer(minLength: 0)
      Button("Back to sign in", action: onLeave).buttonStyle(.borderless).font(AglynFont.subheadline)
    }
    .padding(AglynSpace.four)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
