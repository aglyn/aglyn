// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// Detail screens pushed onto the shell's own stack (AGL-3945). A screen pushed by a view-based `NavigationLink`, or by
// `navigationDestination(item:)`, is not part of the stack's path, so the next push onto the path (a page opened in the
// in-app browser, a record a link names) dropped it, and Back skipped it. A screen pushes through these instead: onto
// the shell's path where the shell offers one, and the platform's own way where it does not (a sheet's own stack).

/// A view pushed onto the shell's path, compared by its identity.
public struct AglynPushedView: Hashable, Identifiable {
  public let id = UUID()
  public let view: AnyView

  public init<V: View>(_ view: V) { self.view = AnyView(view) }

  public static func == (a: AglynPushedView, b: AglynPushedView) -> Bool { a.id == b.id }
  public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// The shell's push, for screens inside it: nil where there is no shell path (a sheet's own stack, a preview).
public struct AglynPushAction {
  let push: @MainActor (AglynPushedView) -> Void

  public init(_ push: @escaping @MainActor (AglynPushedView) -> Void) { self.push = push }

  @MainActor public func callAsFunction<V: View>(_ view: V) { push(AglynPushedView(view)) }
}

private struct AglynPushKey: EnvironmentKey {
  static let defaultValue: AglynPushAction? = nil
}

extension EnvironmentValues {
  public var aglynPush: AglynPushAction? {
    get { self[AglynPushKey.self] }
    set { self[AglynPushKey.self] = newValue }
  }
}

/// A row that opens a detail screen: pushed onto the shell's path, else a `NavigationLink`. `disclosure: false` leaves
/// out the trailing chevron, for a record row whose design draws none (Figma List/Order row, Size=Phone).
public struct AglynPushLink<Destination: View, Label: View>: View {
  @Environment(\.aglynPush) private var push
  let destination: () -> Destination
  let disclosure: Bool
  let label: Label

  public init(
    disclosure: Bool = true, @ViewBuilder destination: @escaping () -> Destination, @ViewBuilder label: () -> Label
  ) {
    self.destination = destination
    self.disclosure = disclosure
    self.label = label()
  }

  public var body: some View {
    if let push {
      Button {
        push(destination())
      } label: {
        HStack {
          label
          if disclosure {
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
              .accessibilityHidden(true)
          }
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.aglynRow)
    } else {
      NavigationLink(destination: destination) { label }
    }
  }
}

extension View {
  /// Pushes a detail screen while `item` is set (a record a list or a link opened): onto the shell's path, else the
  /// platform's `navigationDestination(item:)`. The item is cleared once the screen is on the path.
  public func aglynPushDestination<Item: Hashable, Destination: View>(
    item: Binding<Item?>, @ViewBuilder destination: @escaping (Item) -> Destination
  ) -> some View {
    modifier(AglynPushDestination(item: item, destination: destination))
  }
}

private struct AglynPushDestination<Item: Hashable, Destination: View>: ViewModifier {
  @Environment(\.aglynPush) private var push
  @Binding var item: Item?
  let destination: (Item) -> Destination

  func body(content: Content) -> some View {
    if let push {
      content.onChange(of: item, initial: true) { _, next in
        guard let next else { return }
        push(destination(next))
        item = nil
      }
    } else {
      content.navigationDestination(item: $item, destination: destination)
    }
  }
}
