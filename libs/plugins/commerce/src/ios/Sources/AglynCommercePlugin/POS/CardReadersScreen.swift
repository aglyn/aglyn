// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import AglynPluginHost
import AglynUI
import SwiftUI
#if canImport(UIKit)
  import UIKit
#endif

let posReadersRoute = "/api/commerce/pos-readers"

/// A smart reader as the readers route lists it.
struct PosReaderRow: Equatable, Identifiable {
  let id: String
  let label: String
  let registerID: String?
  let deviceType: String?
  let serialNumber: String?
  let status: String
  let livemode: Bool
  var online: Bool { status == "online" }
}

/// What the readers route answers for a site.
struct PosReadersList: Equatable {
  let available: Bool
  let testMode: Bool
  let locationReady: Bool
  let readers: [PosReaderRow]
}

/// The address a store's card readers are used at, as the readers route takes it.
struct ReaderAddress: Equatable {
  var line1 = ""
  var city = ""
  var state = ""
  var postalCode = ""
  var country = "US"

  var json: JSONValue {
    .object([
      "line1": .string(line1.trimmingCharacters(in: .whitespaces)),
      "city": .string(city.trimmingCharacters(in: .whitespaces)),
      "state": .string(state.trimmingCharacters(in: .whitespaces)),
      "postalCode": .string(postalCode.trimmingCharacters(in: .whitespaces)),
      "country": .string(country.trimmingCharacters(in: .whitespaces).uppercased()),
    ])
  }
}

/// Why a pairing cannot be sent yet, or nil. The route checks again.
func checkReaderPairing(code: String, address: ReaderAddress?) -> String? {
  if code.trimmingCharacters(in: .whitespaces).range(of: "^[A-Za-z0-9-]{3,64}$", options: .regularExpression) == nil {
    return "Enter the code the reader shows on its screen."
  }
  if let address {
    if [address.line1, address.city, address.postalCode].contains(where: { $0.trimmingCharacters(in: .whitespaces).isEmpty }) {
      return "Enter the street, city and postal code."
    }
    if address.country.trimmingCharacters(in: .whitespaces).range(of: "^[A-Za-z]{2}$", options: .regularExpression) == nil {
      return "Enter the two-letter country code, such as US."
    }
  }
  return nil
}

/// The site's smart readers, through the route the console's POS devices card calls, under the same staff gate.
struct SmartReadersAPI {
  let api: ConsoleAPIClient
  let hostID: String

  func list(refresh: Bool = false) async throws -> PosReadersList {
    readPosReadersList(
      try await api.request(
        posReadersRoute, method: .post,
        body: ["hostId": .string(hostID), "action": "list", "refresh": .bool(refresh)]))
  }

  func pair(code: String, label: String, registerID: String?, address: ReaderAddress?) async throws {
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "action": "register",
      "registrationCode": .string(code.trimmingCharacters(in: .whitespaces)),
      "label": .string(label.trimmingCharacters(in: .whitespaces)),
    ]
    if let registerID, !registerID.isEmpty { body["registerId"] = .string(registerID) }
    if let address { body["address"] = address.json }
    _ = try await api.request(posReadersRoute, method: .post, body: .object(body))
  }

  /// Renames a reader, or moves it to another register ("" is any register).
  func update(readerID: String, label: String? = nil, registerID: String? = nil) async throws {
    var body: [String: JSONValue] = ["hostId": .string(hostID), "action": "update", "readerId": .string(readerID)]
    if let label { body["label"] = .string(label.trimmingCharacters(in: .whitespaces)) }
    if let registerID { body["registerId"] = .string(registerID) }
    _ = try await api.request(posReadersRoute, method: .post, body: .object(body))
  }

  func remove(readerID: String) async throws {
    _ = try await api.request(
      posReadersRoute, method: .post,
      body: ["hostId": .string(hostID), "action": "remove", "readerId": .string(readerID)])
  }
}

/// The register's card readers: whether this store can take cards at all,
/// this device's own reader (Tap to Pay on iPhone or a Bluetooth reader,
/// through the Stripe Terminal SDK, on iPhone and iPad: find, connect,
/// battery, software updates, disconnect), and the smart readers on the
/// counter, paired, renamed, moved and removed here as in the console's POS
/// devices card (`commerce/pos-readers`).
struct CardReadersScreen: View {
  let context: NativePluginContext
  @State private var readiness: Load<TerminalReadiness> = .loading
  @State private var list: PosReadersList?
  @State private var registers: [PosRegister] = []
  @State private var refresh = 0
  @State private var pairing = false
  @State private var renaming: PosReaderRow?
  @State private var removing: PosReaderRow?
  @State private var smartError: String?
  @State private var collector = DeviceCardCollector.make()

  private var hostID: String { context.hostID ?? "" }
  private var smart: SmartReadersAPI { SmartReadersAPI(api: context.api, hostID: hostID) }

  var body: some View {
    Form {
      Section("This store") {
        switch readiness {
        case .loading:
          SkeletonRows(count: 3)
        case .failed(let message):
          AglynNotice(message, tone: .error)
          Button("Try again") { refresh += 1 }
        case .ready(let value):
          check("Card payments offered here", value.available, value.testMode ? "Test mode: no real cards are charged." : nil)
          check(
            "Payments set up in the console", value.merchantReady,
            value.merchantReady ? nil : "Finish payments setup in the console before taking cards.")
          check(
            "Store address for card readers", value.locationReady,
            value.locationReady ? nil : "Pair a smart reader below with the store's address, or add it in the console's register settings.")
        }
      }
      if let collector, let controls = collector.deviceReaders {
        if collector.kinds.contains(.tapToPay) {
          TapToPaySection(
            collector: collector, controls: controls, hostID: hostID,
            sessions: CommerceTerminalConnection(api: context.api), ready: readiness.value?.ready == true)
        }
        DeviceReaderSection(
          collector: collector, controls: controls, hostID: hostID,
          sessions: CommerceTerminalConnection(api: context.api), ready: readiness.value?.ready == true)
      } else {
        Section("This device") {
          AglynRow(
            "Smart readers and QR payments",
            subtitle: "This device has no card reader of its own. Take cards on a smart reader below, with Enter card manually, or by Card (QR).",
            systemImage: "wave.3.right")
        }
      }
      smartSection
    }
    .formStyle(.grouped)
    .navigationTitle("Card readers")
    .refreshable { refresh += 1 }
    .task { collector?.deviceReaders?.permitTapToPayTerms(tapToPayTermsPermitted(isStaff: context.staff != nil)) }
    .tapToPayEducationAfterTerms(collector)
    .task(id: refresh) { await load(fresh: refresh > 0) }
    .task { await loadRegisters() }
    .sheet(isPresented: $pairing) {
      PairReaderSheet(
        api: smart, registers: registers, needsAddress: readiness.value?.locationReady == false
      ) {
        pairing = false
        refresh += 1
      }
    }
    .sheet(item: $renaming) { reader in
      RenameReaderSheet(api: smart, reader: reader) {
        renaming = nil
        refresh += 1
      }
    }
    .confirmationDialog(
      "Remove \(removing?.label ?? "this reader")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible
    ) {
      Button("Remove reader", role: .destructive) {
        guard let reader = removing else { return }
        Task { await act { try await smart.remove(readerID: reader.id) } }
      }
    } message: {
      Text("The reader is unpaired from this store. Pair it again with a new code to use it.")
    }
  }

  @ViewBuilder private var smartSection: some View {
    Section {
      if list == nil, case .loading = readiness {
        SkeletonRows(count: 2)
      } else if let readers = list?.readers, !readers.isEmpty {
        ForEach(readers) { reader in smartRow(reader) }
      } else {
        Text("No smart reader is paired with this store yet. A WisePOS E or S700 shows a code to pair it with.")
          .foregroundStyle(.secondary)
      }
      if let smartError { AglynNotice(smartError, tone: .error) { self.smartError = nil } }
    } header: {
      AglynSectionHeader("Smart readers") {
        Button("Pair a reader", systemImage: "plus") {
          smartError = nil
          pairing = true
        }
        .disabled(readiness.value?.available != true)
        .accessibilityIdentifier("pair-reader")
      }
    }
  }

  private func smartRow(_ reader: PosReaderRow) -> some View {
    let register = registers.first { $0.id == reader.registerID }?.name ?? "Any register"
    return AglynRow(
      reader.label, subtitle: "\(register) · \(reader.livemode ? "Live" : "Test mode")", systemImage: "creditcard.and.123"
    ) {
      HStack(spacing: AglynSpace.one) {
        StatusChip(reader.online ? "Online" : "Offline", tone: reader.online ? .success : .neutral)
        Menu {
          Button("Rename", systemImage: "pencil") { renaming = reader }
          if !registers.isEmpty {
            Picker(
              "Register",
              selection: Binding(
                get: { reader.registerID ?? "" },
                set: { next in Task { await act { try await smart.update(readerID: reader.id, registerID: next) } } })
            ) {
              Text("Any register").tag("")
              ForEach(registers) { Text($0.name).tag($0.id) }
            }
          }
          Button("Remove", systemImage: "trash", role: .destructive) { removing = reader }
        } label: {
          Image(systemName: "ellipsis.circle").accessibilityLabel("\(reader.label) actions")
        }
        // The ellipsis is the menu's affordance; the Mac's extra chevron beside it doubled it.
        .menuIndicator(.hidden)
        .accessibilityIdentifier("reader-actions-\(reader.id)")
      }
    }
    .accessibilityIdentifier("reader-\(reader.id)")
  }

  private func check(_ title: String, _ ok: Bool, _ detail: String?) -> some View {
    AglynRow(title, subtitle: detail, systemImage: ok ? "checkmark.circle" : "exclamationmark.triangle") {
      StatusChip(ok ? "Ready" : "Needed", tone: ok ? .success : .warning)
    }
  }

  private func act(_ call: () async throws -> Void) async {
    smartError = nil
    do {
      try await call()
      removing = nil
      refresh += 1
    } catch {
      smartError =
        (error as? ConsoleAPIError).flatMap { $0.status == 0 ? nil : $0.message }
        ?? "That did not go through. Check the connection and try again."
    }
  }

  private func load(fresh: Bool) async {
    if readiness.value == nil { readiness = .loading }
    do {
      readiness = .ready(try await CommerceTerminalConnection(api: context.api).readiness(hostID: hostID))
    } catch {
      let message =
        (error as? CardReaderSetupError)?.message
        ?? ((error as? ConsoleAPIError).flatMap { $0.status == 0 ? nil : $0.message })
        ?? "Card readers could not be checked. Check the connection and try again."
      readiness = .failed(message)
    }
    list = try? await smart.list(refresh: fresh)
  }

  private func loadRegisters() async {
    let all: [PosRegister] = await withCheckedContinuation { continuation in
      var listening: FirestoreListening?
      var answered = false
      listening = context.firestore.listen(registersQuery(hostID)) { result in
        guard !answered else { return }
        answered = true
        listening?.remove()
        continuation.resume(returning: (try? result.get())?.map(posRegister) ?? [])
      }
    }
    registers = sortRegisters(all)
  }
}

/// This device's own reader: Tap to Pay on this iPhone, or a Bluetooth reader
/// near it. Find, pick, connect, then battery, software updates and
/// disconnect. Location is asked for only when the cashier connects one.
private struct DeviceReaderSection: View {
  let collector: CardCollector
  let controls: DeviceReaderControls
  let hostID: String
  let sessions: CardReaderSessionSource
  let ready: Bool
  @State private var busy = false
  @Environment(\.openURL) private var openURL

  var body: some View {
    Section {
      switch ownState {
      case .connected(let label, let kind, let testMode):
        AglynRow(
          label,
          subtitle: [
            testMode ? "Ready · test mode" : "Ready",
            readerBatteryText(controls.connectedReader?.batteryLevel, charging: controls.connectedReader?.charging ?? false),
            controls.connectedReader?.softwareVersion.map { "Software \($0)" },
          ].compactMap { $0 }.joined(separator: " · "),
          systemImage: kind == .tapToPay ? "wave.3.right" : "creditcard.and.123"
        ) {
          StatusChip("Connected", tone: .success)
        }
        .accessibilityIdentifier("device-reader-connected")
        updateRow
        Button("Disconnect", role: .destructive) { run { await controls.forget() } }
          .disabled(busy || controls.update?.progress != nil)
          .accessibilityIdentifier("device-reader-disconnect")
      case .connecting(let what):
        AglynRow(what, subtitle: "Keep the reader on and close by.", systemImage: "wave.3.right") { ProgressView() }
      case .unavailable, .disconnected:
        if case .unavailable(let reason) = collector.state {
          AglynNotice(reason, tone: .warning)
        }
        ForEach(collector.kinds.filter { $0 != .tapToPay }, id: \.self) { kind in
          Button {
            // Not `run`: a search lasts until Stop or its timeout, and the readers it
            // lists must be connectable meanwhile (connecting ends the search).
            Task { await controls.discover(kind, hostID: hostID, sessions: sessions) }
          } label: {
            AglynRow(
              kind == .tapToPay ? "Set up Tap to Pay on iPhone" : "Find Bluetooth readers",
              subtitle: DeviceCardCollector.detail(kind),
              systemImage: kind == .tapToPay ? "wave.3.right" : "antenna.radiowaves.left.and.right")
          }
          .buttonStyle(.aglynRow)
          .disabled(busy || isSearching || !ready)
          .accessibilityIdentifier(kind == .tapToPay ? "device-reader-tap-to-pay" : "device-reader-bluetooth")
        }
      }
      discoveryRows
    } header: {
      Text("This device")
    } footer: {
      if !collector.state.isConnected {
        Text("Aglyn POS asks for location when you connect a reader (card networks require the location of in-person payments), and for Bluetooth when it looks for one.")
      }
    }
  }

  private var isSearching: Bool {
    if case .searching = controls.discovery { return true }
    return false
  }

  /// The reader state this section shows: Tap to Pay on iPhone has a section of its own.
  private var ownState: CardCollectorState {
    switch collector.state {
    case .connected(_, .tapToPay, _): .disconnected
    case .connecting where isTapToPayConnecting: .disconnected
    default: collector.state
    }
  }

  private var isTapToPayConnecting: Bool {
    if case .searching(.tapToPay, _) = controls.discovery { return true }
    if case .connecting(let words) = collector.state { return words.contains(TapToPayIPhone.title) }
    return false
  }

  @ViewBuilder private var updateRow: some View {
    if let update = controls.update {
      if let progress = update.progress {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          Text("Updating the reader… keep it on and nearby.").font(AglynFont.subheadline)
          ProgressView(value: progress)
        }
        .accessibilityIdentifier("device-reader-updating")
      } else {
        AglynNotice(
          (update.required
            ? "This reader needs a software update before its next payment."
            : "A software update is ready for this reader.")
            + (update.duration.map { " It takes \($0)." } ?? ""),
          tone: update.required ? .warning : .info, actionTitle: "Install update"
        ) {
          run { await controls.installUpdate() }
        }
        .accessibilityIdentifier("device-reader-update")
      }
    }
  }

  @ViewBuilder private var discoveryRows: some View {
    switch controls.discovery {
    case .idle:
      EmptyView()
    // Tap to Pay on iPhone's own search and failures show in its section.
    case .searching(.tapToPay, _), .found(.tapToPay, _):
      EmptyView()
    case .failed(let message) where message == controls.tapToPayNotice?.message:
      EmptyView()
    case .failed(let message):
      AglynNotice(message, tone: .error)
      if message == readerLocationRefused {
        Button("Open Settings") { openSettings() }
      }
    case .searching(let kind, let readers):
      HStack(spacing: AglynSpace.one) {
        ProgressView()
        Text(kind == .tapToPay ? "Starting Tap to Pay…" : "Looking for card readers…").foregroundStyle(.secondary)
        Spacer()
        Button("Stop looking") { Task { await controls.cancelDiscovery() } }.buttonStyle(.borderless)
      }
      choices(readers)
    case .found(let kind, let readers):
      if readers.isEmpty {
        Text(
          kind == .tapToPay
            ? "Tap to Pay is not available on this iPhone."
            : "No card reader answered. Turn the reader on, keep it close and try again."
        )
        .foregroundStyle(.secondary)
      }
      choices(readers)
    }
  }

  private func choices(_ readers: [DeviceReader]) -> some View {
    ForEach(readers) { reader in
      AglynRow(
        reader.label,
        subtitle: ([reader.kind == .tapToPay ? "This iPhone" : "Bluetooth"] + [readerBatteryText(reader.batteryLevel)].compactMap { $0 })
          .joined(separator: " · "),
        systemImage: reader.kind == .tapToPay ? "wave.3.right" : "creditcard.and.123"
      ) {
        Button("Connect") { run { await controls.connect(to: reader, hostID: hostID, sessions: sessions) } }
          .buttonStyle(.aglynProminent)
          .disabled(busy)
          .accessibilityIdentifier("device-reader-connect-\(reader.id)")
      }
    }
  }

  private func run(_ work: @escaping () async -> Void) {
    guard !busy else { return }
    busy = true
    Task {
      await work()
      busy = false
    }
  }

  private func openSettings() {
    #if canImport(UIKit)
      if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    #endif
  }
}

/// Pairs a smart reader the merchant bought: the code its screen shows, a
/// name, the register it serves, and the store's address when the site has
/// no reader location yet.
struct PairReaderSheet: View {
  let api: SmartReadersAPI
  let registers: [PosRegister]
  let needsAddress: Bool
  let done: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var code = ""
  @State private var label = ""
  @State private var registerID = ""
  @State private var address = ReaderAddress()
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Pairing code", text: $code)
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
            #endif
            .accessibilityIdentifier("reader-code")
          TextField("Name, like Front counter", text: $label).accessibilityIdentifier("reader-name")
          if !registers.isEmpty {
            Picker("Register", selection: $registerID) {
              Text("Any register").tag("")
              ForEach(registers) { Text($0.name).tag($0.id) }
            }
          }
        } footer: {
          Text("On the reader, open Settings and choose Generate pairing code, then type the code it shows.")
        }
        if needsAddress {
          Section {
            TextField("Street", text: $address.line1).accessibilityIdentifier("reader-street")
            TextField("City", text: $address.city).accessibilityIdentifier("reader-city")
            TextField("State", text: $address.state).accessibilityIdentifier("reader-state")
            TextField("Postal code", text: $address.postalCode).accessibilityIdentifier("reader-postal")
            TextField("Country", text: $address.country).accessibilityIdentifier("reader-country")
          } header: {
            Text("Where the reader is used")
          } footer: {
            Text("Stripe sets card readers up for this address's country.")
          }
        }
        if let error { Section { AglynNotice(error, tone: .error) } }
      }
      .formStyle(.grouped)
      .navigationTitle("Pair a reader")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Pair") { Task { await pair() } }
            .accessibilityIdentifier("reader-pair-confirm")
            .disabled(checkReaderPairing(code: code, address: needsAddress ? address : nil) != nil || busy)
        }
      }
    }
  }

  private func pair() async {
    busy = true
    error = nil
    do {
      try await api.pair(code: code, label: label, registerID: registerID, address: needsAddress ? address : nil)
      done()
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "The reader could not be paired. Try again."
    }
    busy = false
  }
}

/// Renames a smart reader, as the console's Rename does.
struct RenameReaderSheet: View {
  let api: SmartReadersAPI
  let reader: PosReaderRow
  let done: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var label = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        TextField("Name", text: $label)
        if let error { AglynNotice(error, tone: .error) }
      }
      .formStyle(.grouped)
      .navigationTitle("Rename reader")
      .onAppear { label = reader.label }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            Task {
              busy = true
              do {
                try await api.update(readerID: reader.id, label: label)
                done()
              } catch {
                self.error = (error as? ConsoleAPIError)?.message ?? "The reader could not be renamed. Try again."
              }
              busy = false
            }
          }
          .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        }
      }
    }
  }
}

/// Tap to Pay on iPhone, in a section of its own (Apple 3.6, 3.9.1, 4.3): whether it is ready, its setup progress,
/// setting it up outside checkout, and Apple's own guide to taking payments at any time.
private struct TapToPaySection: View {
  let collector: CardCollector
  let controls: DeviceReaderControls
  let hostID: String
  let sessions: CardReaderSessionSource
  let ready: Bool
  @State private var busy = false
  @State private var guideError: String?

  private var connected: Bool {
    if case .connected(_, .tapToPay, _) = collector.state { return true }
    return false
  }

  private var progress: Double? {
    guard case .connecting(let words) = collector.state, words.contains(TapToPayIPhone.title) else { return nil }
    return controls.update?.progress ?? 0
  }

  var body: some View {
    Section {
      if connected {
        AglynRow(
          TapToPayIPhone.title, subtitle: "Customers tap a card or phone on this iPhone.",
          systemImage: TapToPayIPhone.symbol
        ) {
          StatusChip("Ready", tone: .success)
        }
        .accessibilityIdentifier("tap-to-pay-ready")
      } else if let progress {
        AglynRow(
          TapToPayIPhone.title, subtitle: "Setting up this iPhone to take cards…", systemImage: TapToPayIPhone.symbol
        ) {
          StatusChip("\(Int((progress * 100).rounded()))%", tone: .info)
        }
        ProgressView(value: progress)
          .accessibilityIdentifier("tap-to-pay-preparing")
      } else {
        if let notice = controls.tapToPayNotice {
          AglynNotice(notice.message, tone: .warning)
        }
        Button {
          setUp()
        } label: {
          AglynRow(
            "Set up \(TapToPayIPhone.title)", subtitle: DeviceCardCollector.detail(.tapToPay),
            systemImage: TapToPayIPhone.symbol)
        }
        .buttonStyle(.aglynRow)
        .disabled(busy || !ready)
        .accessibilityIdentifier("device-reader-tap-to-pay")
      }
      #if os(iOS) && canImport(ProximityReader)
        Button {
          Task { guideError = await TapToPayEducation.present() }
        } label: {
          AglynRow("How to accept payments", subtitle: "Cards, phones and watches, and PIN entry", systemImage: "book")
        }
        .buttonStyle(.aglynRow)
        .accessibilityIdentifier("tap-to-pay-education")
        if let guideError { AglynNotice(guideError, tone: .error) }
      #endif
    } header: {
      Text(TapToPayIPhone.title)
    } footer: {
      Text(
        connected
          ? "Apple’s own guide opens from How to accept payments. \(TapToPayIPhone.title) needs iOS \(TapToPayIPhone.minimumOSMajor) or later."
          : "\(TapToPayIPhone.title) is ready to take cards as soon as setup finishes. Keep the app open.")
    }
  }

  private func setUp() {
    guard !busy else { return }
    busy = true
    Task {
      // Asked here, well before a sale: whether the app may say when a card was not approved while it was away.
      await PosCardNotifier.askPermission()
      _ = await collector.connect(hostID: hostID, kind: .tapToPay, sessions: sessions)
      busy = false
    }
  }
}
