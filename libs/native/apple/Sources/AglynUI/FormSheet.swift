// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A titled form in a sheet: Cancel, and a confirm that runs `save`, holds
/// still while it runs, closes the sheet when it succeeds and shows why it
/// failed in place when it does not. The Kotlin kit's `FormSheet`.
///
/// `hold` is set while the record the form was opened on is only the device
/// cache's copy (AGL-4047): the form says so, and a confirm pressed then is
/// kept and runs once the server's copy is in (`AglynHeldPress`), or shows the
/// refusal if it never comes.
public struct AglynFormSheet<Content: View>: View {
  let title: String
  let confirm: String
  /// What the confirm says while `save` runs: "Saving…", or "Sending…" for a form that sends.
  let working: String
  let destructive: Bool
  let canConfirm: Bool
  let hold: AglynFormHold?
  let save: () async throws -> Void
  let content: Content
  @Environment(\.dismiss) private var dismiss
  @State private var busy = false
  @State private var error: String?
  @State private var held = AglynHeldPress()

  public init(
    _ title: String, confirm: String = "Save", working: String = "Saving…", destructive: Bool = false,
    canConfirm: Bool = true, hold: AglynFormHold? = nil, save: @escaping () async throws -> Void,
    @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.confirm = confirm
    self.working = working
    self.destructive = destructive
    self.canConfirm = canConfirm
    self.hold = hold
    self.save = save
    self.content = content()
  }

  private static var errorID: String { "form-sheet-error" }

  private func run() {
    busy = true
    error = nil
    Task {
      do {
        try await save()
        dismiss()
      } catch {
        self.error = (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Try again."
      }
      busy = false
    }
  }

  public var body: some View {
    NavigationStack {
      ScrollViewReader { proxy in
        Form {
          if let error { AglynNotice(error, tone: .error).id(Self.errorID) }
          if let refusal = held.refusal {
            AglynNotice(refusal, tone: .warning).accessibilityIdentifier("form-sheet-unconfirmed")
          } else if let hold {
            Section {
              Text(hold.checking).font(AglynFont.caption).foregroundStyle(.secondary)
                .accessibilityIdentifier("form-sheet-checking")
            }
          }
          content
        }
        .formStyle(.grouped)
        .aglynPhoneFormEdges()
        // Why it did not save is read where it is: the form scrolls to it, rather than the new banner pushing the
        // field being typed in under the keyboard.
        .onChange(of: error) { _, error in
          guard error != nil else { return }
          withAnimation { proxy.scrollTo(Self.errorID, anchor: .top) }
        }
      }
      .navigationTitle(title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy || held.waiting ? working : confirm, role: destructive ? .destructive : nil) {
            if held.pressed(checking: hold != nil) { run() }
          }
          .disabled(busy || held.waiting || !canConfirm)
          .accessibilityIdentifier("form-sheet-confirm")
        }
      }
      .aglynHeldPress($held, checking: hold != nil, refusal: hold?.unconfirmed ?? "") {
        if canConfirm { run() }
      }
      // A help or legal link in the form opens on the sheet's own stack, over the form it was opened from.
      .aglynBrowserDestination()
    }
    .aglynSheetMinimumSize(width: 380, height: 420)
  }
}
