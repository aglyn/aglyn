// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import AglynPluginHost
import AglynUI
import SwiftUI

let posReadersRoute = "/api/commerce/pos-readers"

/// The register's card readers: whether this store can take cards at all,
/// this device's own reader (Tap to Pay or a Bluetooth reader, through the
/// Stripe Terminal SDK, on iPhone and iPad), and the smart readers on the
/// counter. The merchant buys their own Stripe reader and pairs it here by
/// the code it shows (`commerce/pos-readers`, `register`).
struct CardReadersScreen: View {
  let context: NativePluginContext
  @State private var readiness: Load<TerminalReadiness> = .loading
  @State private var pos: PosContext?
  @State private var refresh = 0
  @State private var pairing = false
  @State private var collector = DeviceCardCollector.make()
  @State private var connecting = false
  @State private var deviceProblem: String?

  private var hostID: String { context.hostID ?? "" }

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
            value.locationReady ? nil : "Add the address card readers are used at, in the console's register settings.")
        }
      }
      Section {
        if let collector {
          deviceRow(collector)
        } else {
          AglynRow(
            "Smart readers only", subtitle: "This Mac takes cards on the smart readers below.", systemImage: "wave.3.right")
        }
        if let deviceProblem { AglynNotice(deviceProblem, tone: .warning) }
      } header: {
        Text("This device")
      }
      Section {
        if pos == nil, case .loading = readiness {
          SkeletonRows(count: 2)
        } else if let readers = pos?.readers, !readers.isEmpty {
          ForEach(readers) { reader in
            AglynRow(reader.label, subtitle: reader.livemode ? "Live" : "Test mode", systemImage: "creditcard.and.123") {
              StatusChip(reader.online ? "Online" : "Offline", tone: reader.online ? .success : .neutral)
            }
            .accessibilityIdentifier("reader-\(reader.id)")
          }
        } else {
          Text("No smart reader is paired with this store yet. A WisePOS E or S700 shows a code to pair it with.")
            .foregroundStyle(.secondary)
        }
      } header: {
        AglynSectionHeader("Smart readers") {
          Button("Pair a reader", systemImage: "plus") { pairing = true }
            .disabled(readiness.value?.available != true)
            .accessibilityIdentifier("pair-reader")
        }
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Card readers")
    .refreshable { refresh += 1 }
    .task(id: refresh) { await load() }
    .sheet(isPresented: $pairing) {
      PairReaderSheet(context: context) {
        pairing = false
        refresh += 1
      }
    }
  }

  private func check(_ title: String, _ ok: Bool, _ detail: String?) -> some View {
    AglynRow(title, subtitle: detail, systemImage: ok ? "checkmark.circle" : "exclamationmark.triangle") {
      StatusChip(ok ? "Ready" : "Needed", tone: ok ? .success : .warning)
    }
  }

  @ViewBuilder
  private func deviceRow(_ collector: CardCollector) -> some View {
    switch collector.state {
    case .connected(let label, _, let testMode):
      AglynRow(label, subtitle: testMode ? "Ready · test mode" : "Ready", systemImage: "wave.3.right") {
        StatusChip("Connected", tone: .success)
      }
      Button("Disconnect", role: .destructive) { Task { await collector.disconnect() } }
    case .connecting(let what):
      AglynRow(what, subtitle: "Connecting…", systemImage: "wave.3.right") { ProgressView() }
    case .unavailable(let reason):
      AglynRow("Tap to Pay and Bluetooth readers", subtitle: reason, systemImage: "wave.3.right") {
        StatusChip("Not available")
      }
    case .disconnected:
      ForEach(collector.kinds, id: \.self) { kind in
        Button {
          Task { await connect(collector, kind) }
        } label: {
          AglynRow(DeviceCardCollector.title(kind), subtitle: DeviceCardCollector.detail(kind), systemImage: "wave.3.right")
        }
        .buttonStyle(.plain)
        .disabled(connecting || readiness.value?.ready != true)
      }
    }
  }

  private func connect(_ collector: CardCollector, _ kind: CardCollectorKind) async {
    connecting = true
    deviceProblem = nil
    let state = await collector.connect(hostID: hostID, kind: kind, sessions: CommerceTerminalConnection(api: context.api))
    if case .unavailable(let reason) = state { deviceProblem = reason }
    connecting = false
  }

  private func load() async {
    readiness = .loading
    do {
      readiness = .ready(try await CommerceTerminalConnection(api: context.api).readiness(hostID: hostID))
    } catch {
      let message =
        (error as? CardReaderSetupError)?.message
        ?? ((error as? ConsoleAPIError).flatMap { $0.status == 0 ? nil : $0.message })
        ?? "Card readers could not be checked. Check the connection and try again."
      readiness = .failed(message)
    }
    pos = try? await ConsolePosSaleAPI(api: context.api, hostID: hostID).context()
  }
}

/// Pairs a smart reader the merchant bought: the code its screen shows, a
/// name, and the register it serves.
struct PairReaderSheet: View {
  let context: NativePluginContext
  let done: () -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var code = ""
  @State private var label = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Registration code", text: $code)
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
            #endif
            .accessibilityIdentifier("reader-code")
          TextField("Name, like Front counter", text: $label)
        } footer: {
          Text("On the reader, open Settings and choose Generate pairing code, then type the code it shows.")
        }
        if let error { Section { AglynNotice(error, tone: .error) } }
      }
      .formStyle(.grouped)
      .navigationTitle("Pair a reader")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Pair") { Task { await pair() } }
            .disabled(code.trimmingCharacters(in: .whitespaces).count < 3 || busy)
        }
      }
    }
  }

  private func pair() async {
    busy = true
    error = nil
    do {
      _ = try await context.api.request(
        posReadersRoute, method: .post,
        body: [
          "hostId": .string(context.hostID ?? ""), "action": "register",
          "registrationCode": .string(code.trimmingCharacters(in: .whitespaces)),
          "label": .string(label.trimmingCharacters(in: .whitespaces)),
        ])
      done()
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "The reader could not be paired. Try again."
    }
    busy = false
  }
}
