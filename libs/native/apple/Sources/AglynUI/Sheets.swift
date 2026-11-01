// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

/// A small form in a sheet that makes one change (New page, Rename, Move):
/// a title, an optional sentence, the fields, the route's refusal when it
/// refused, and Cancel and the confirming action in the toolbar (Return
/// confirms, Escape cancels on a keyboard). `below` holds any further sections
/// of a longer form, under the fields and their sentence. The Kotlin kit's
/// `ActionDialog`.
public struct AglynActionSheet<Fields: View, Below: View>: View {
  let title: String
  let message: String?
  let confirmLabel: String
  let confirmEnabled: Bool
  let destructive: Bool
  let busy: Bool
  let error: String?
  let onCancel: () -> Void
  let onConfirm: () -> Void
  let fields: Fields
  let below: Below

  public init(
    _ title: String, message: String? = nil, confirmLabel: String, confirmEnabled: Bool = true,
    destructive: Bool = false, busy: Bool, error: String?, onCancel: @escaping () -> Void,
    onConfirm: @escaping () -> Void, @ViewBuilder fields: () -> Fields, @ViewBuilder below: () -> Below
  ) {
    self.title = title
    self.message = message
    self.confirmLabel = confirmLabel
    self.confirmEnabled = confirmEnabled
    self.destructive = destructive
    self.busy = busy
    self.error = error
    self.onCancel = onCancel
    self.onConfirm = onConfirm
    self.fields = fields()
    self.below = below()
  }

  private static var errorID: String { "sheet-error" }

  public var body: some View {
    NavigationStack {
      ScrollViewReader { proxy in
        Form {
          if let error {
            Section { AglynNotice(error, tone: .error) }
              .id(Self.errorID)
              .accessibilityIdentifier("sheet-error")
          }
          Section {
            fields
          } footer: {
            if let message { Text(message) }
          }
          below
        }
        .formStyle(.grouped)
        // A long form's refusal is read where it is: the confirm stays in view however far the form has scrolled.
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
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", action: onCancel).disabled(busy)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(role: destructive ? .destructive : nil, action: onConfirm) {
            if busy { ProgressView().controlSize(.small) } else { Text(confirmLabel) }
          }
          .disabled(busy || !confirmEnabled)
          .keyboardShortcut(.defaultAction)
          .accessibilityIdentifier("sheet-confirm")
        }
      }
      .interactiveDismissDisabled(busy)
      // A help or legal link in the sheet opens on the sheet's own stack, over the form it was opened from.
      .aglynBrowserDestination()
    }
    .aglynSheetMinimumSize(width: 420, height: 320)
  }
}

extension AglynActionSheet where Below == EmptyView {
  public init(
    _ title: String, message: String? = nil, confirmLabel: String, confirmEnabled: Bool = true,
    destructive: Bool = false, busy: Bool, error: String?, onCancel: @escaping () -> Void,
    onConfirm: @escaping () -> Void, @ViewBuilder fields: () -> Fields
  ) {
    self.init(
      title, message: message, confirmLabel: confirmLabel, confirmEnabled: confirmEnabled, destructive: destructive,
      busy: busy, error: error, onCancel: onCancel, onConfirm: onConfirm, fields: fields, below: { EmptyView() })
  }
}

/// A counter under a capped text field: `12/80`.
public struct AglynCharacterCount: View {
  let count: Int
  let limit: Int

  public init(_ count: Int, of limit: Int) {
    self.count = count
    self.limit = limit
  }

  public var body: some View {
    Text("\(count)/\(limit)")
      .font(AglynFont.caption.monospacedDigit())
      .foregroundStyle(count >= limit ? AglynColor.warning : .secondary)
      .accessibilityLabel("\(count) of \(limit) characters")
  }
}

/// The system clipboard, on every Apple platform.
public enum AglynClipboard {
  @MainActor
  public static func copy(_ text: String) {
    #if os(iOS)
      UIPasteboard.general.string = text
    #elseif os(macOS)
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
    #endif
  }
}

extension String {
  /// At most `limit` characters, for a capped field's binding.
  public func capped(_ limit: Int) -> String { count > limit ? String(prefix(limit)) : self }
}

public extension View {
  /// A sheet's smallest size on the Mac, where a sheet is only as large as its content. iOS sizes its sheets itself,
  /// and a phone is narrower than these minimums: the sheet would run past both edges and clip its Cancel and Done.
  @ViewBuilder
  func aglynSheetMinimumSize(width: CGFloat, height: CGFloat) -> some View {
    #if os(macOS)
      frame(minWidth: width, minHeight: height)
    #else
      self
    #endif
  }
}
