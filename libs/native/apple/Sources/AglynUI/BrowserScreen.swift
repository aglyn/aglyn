// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AuthenticationServices
import Observation
import SwiftUI
import WebKit

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

/// A plain web page the app shows (a site's live address, a preview, a docs,
/// legal or What's new page), in the in-app browser screen.
public struct AglynWebPage: Identifiable, Hashable, Sendable {
  public let url: URL
  public var id: URL { url }

  public init(_ url: URL) { self.url = url }

  /// Where an address the app opens goes: the in-app browser screen, the
  /// system's secure sign-in browser, or the system itself. The Kotlin kit's
  /// `WebDestination`.
  public enum Destination: Equatable, Sendable {
    /// A plain web page: the in-app browser screen.
    case inApp
    /// A provider's sign-in, consent or account step (Google, Stripe): the
    /// secure browser, where the person's saved passwords and the provider's
    /// own protections live; never a web view of ours.
    case secure
    /// Not a web page (mail, phone, an app's link): the app the system picks.
    case system
  }

  /// Hosts whose pages are a provider's sign-in, consent or account step.
  static let secureHosts = ["accounts.google.com", "google.com", "stripe.com", "appleid.apple.com", "login.microsoftonline.com"]

  /// Decides the `Destination` of `url`.
  public static func destination(_ url: URL) -> Destination {
    guard isWebPage(url), let host = url.host()?.lowercased(), !host.isEmpty else { return .system }
    if secureHosts.contains(where: { host == $0 || host.hasSuffix(".\($0)") }) { return .secure }
    return .inApp
  }

  /// Whether `url` is a web page at all: an http or https address. A web
  /// page the browser screen shows keeps its own links to other web pages.
  public static func isWebPage(_ url: URL) -> Bool {
    ["http", "https"].contains(url.scheme?.lowercased() ?? "")
  }

  /// The address the toolbar names under the title: the host and path,
  /// without the scheme, `www.`, the query or a trailing slash
  /// (`juniper-street.aglyn.app/menu`).
  public static func address(_ url: URL) -> String {
    var host = url.host() ?? url.absoluteString
    if host.lowercased().hasPrefix("www.") { host.removeFirst(4) }
    if let port = url.port { host += ":\(port)" }
    let path = url.path(percentEncoded: false)
    return path == "/" || path.isEmpty ? host : host + (path.hasSuffix("/") ? String(path.dropLast()) : path)
  }

  /// The toolbar's title: the page's own once it has one, its host until then.
  public static func title(_ pageTitle: String, url: URL) -> String {
    let trimmed = pageTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { return trimmed }
    var host = url.host() ?? url.absoluteString
    if host.lowercased().hasPrefix("www.") { host.removeFirst(4) }
    return host
  }
}

/// How a page asks to be opened. Today every page is pushed; `newTab` is the
/// seam a ⌘-click comes through, so the shell can give it a tab of its own
/// once the Mac and iPad have tabs.
public enum AglynBrowserDisposition: Equatable, Sendable {
  case push
  case newTab

  /// What the click that is opening a page asked for: ⌘ held asks for a new tab.
  @MainActor
  static var current: AglynBrowserDisposition {
    #if os(macOS)
      NSApp?.currentEvent?.modifierFlags.contains(.command) == true ? .newTab : .push
    #else
      .push
    #endif
  }
}

/// The page a browser screen shows: what WebKit says about it, for the toolbar.
@MainActor
@Observable
public final class AglynBrowserState {
  public var title = ""
  public var url: URL?
  public var canGoBack = false
  public var canGoForward = false
  public var loading = false
  public var progress = 0.0
  weak var webView: WKWebView?
  private var observations: [NSKeyValueObservation] = []

  public init() {}

  func attach(_ webView: WKWebView) {
    self.webView = webView
    observations = [
      webView.observe(\.title) { [weak self] view, _ in MainActor.assumeIsolated { self?.title = view.title ?? "" } },
      webView.observe(\.url) { [weak self] view, _ in MainActor.assumeIsolated { self?.url = view.url } },
      webView.observe(\.canGoBack) { [weak self] view, _ in MainActor.assumeIsolated { self?.canGoBack = view.canGoBack } },
      webView.observe(\.canGoForward) { [weak self] view, _ in
        MainActor.assumeIsolated { self?.canGoForward = view.canGoForward }
      },
      webView.observe(\.isLoading) { [weak self] view, _ in MainActor.assumeIsolated { self?.loading = view.isLoading } },
      webView.observe(\.estimatedProgress) { [weak self] view, _ in
        MainActor.assumeIsolated { self?.progress = view.estimatedProgress }
      },
    ]
  }

  public func back() { webView?.goBack() }
  public func forward() { webView?.goForward() }
  public func reload() { if loading { webView?.stopLoading() } else { webView?.reload() } }
}

/// Opens an address in the system browser, for the browser screen's "Open in
/// browser" (never the environment's `openURL`, which the app answers with
/// the browser screen itself).
@MainActor
public enum AglynSystemBrowser {
  public static func open(_ url: URL) {
    #if os(iOS)
      UIApplication.shared.open(url)
    #elseif os(macOS)
      NSWorkspace.shared.open(url)
    #endif
  }
}

/// The one in-app browser (AGL-3935): a page in a WKWebView as a screen of its
/// own, pushed onto the navigation stack it was opened from. On iPhone the
/// system back gesture leaves it; on iPad and the Mac it fills the main area
/// beside the sidebar. Its toolbar names the page and its address and holds
/// back, forward and reload, and a menu with Open in browser, Copy link and
/// Share. A published page needs no sign-in, so it is never shown through the
/// sign-in session; only OAuth uses that.
public struct AglynBrowserScreen: View {
  let page: AglynWebPage
  @State private var state = AglynBrowserState()
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  public init(_ page: AglynWebPage) { self.page = page }

  private var current: URL { state.url ?? page.url }
  private var title: String { AglynWebPage.title(state.title, url: current) }
  private var address: String { AglynWebPage.address(current) }

  /// A phone's width: back, forward and reload sit in a bar at the foot, where a thumb reaches them.
  private var compact: Bool {
    #if os(iOS)
      sizeClass == .compact
    #else
      false
    #endif
  }

  public var body: some View {
    AglynWebView(url: page.url, state: state)
      .ignoresSafeArea(edges: .bottom)
      .overlay(alignment: .top) {
        if state.loading {
          ProgressView(value: max(state.progress, 0.05))
            .progressViewStyle(.linear)
            .tint(AglynColor.tint)
            .accessibilityLabel("Loading")
        }
      }
      .navigationTitle(title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar { toolbar }
      #else
        // The Mac window has no system toolbar: back, forward, reload and the page menu sit in the screen's head.
        .aglynScreenTitle(title)
        .aglynScreenToolbar(id: "browser") {
          // The page's address beside its controls, as the subtitle the window's title bar used to carry.
          Text(address)
            .font(.system(size: AglynShellMetrics.rowText - 1))
            .foregroundStyle(AglynColor.secondaryText)
            .lineLimit(1)
            .truncationMode(.middle)
            .frame(maxWidth: 320, alignment: .trailing)
            .accessibilityIdentifier("browser-address")
          back
          forward
          reload
          menu
        }
      #endif
      .accessibilityIdentifier("browser-screen")
  }

  #if os(iOS)
    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
      ToolbarItem(placement: .principal) { heading }
      if compact {
        ToolbarItemGroup(placement: .bottomBar) {
          back
          Spacer()
          forward
          Spacer()
          reload
        }
        ToolbarItem(placement: .primaryAction) { menu }
      } else {
        ToolbarItemGroup(placement: .primaryAction) {
          back
          forward
          reload
          menu
        }
      }
    }
  #endif

  /// The page's title over its address, in the middle of a phone's or iPad's bar.
  private var heading: some View {
    VStack(spacing: 0) {
      Text(title).font(AglynFont.strongSubheadline).lineLimit(1)
      Text(address).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
    }
    .frame(maxWidth: 420)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
    .accessibilityIdentifier("browser-heading")
  }

  /// A toolbar button's face: on the Mac the title bar's plain 6-point square (Figma Compact), elsewhere the system's.
  @ViewBuilder
  private func barLabel(_ title: String, systemImage: String) -> some View {
    #if os(macOS)
      AglynBarSymbol(systemImage: systemImage).accessibilityLabel(title)
    #else
      Label(title, systemImage: systemImage)
    #endif
  }

  private var back: some View {
    Button { state.back() } label: { barLabel("Back", systemImage: "chevron.backward") }
      .disabled(!state.canGoBack)
      .help("Back to the previous page")
      .accessibilityLabel("Previous page")
      .accessibilityIdentifier("browser-back")
      .aglynBarButtonStyle()
  }

  private var forward: some View {
    Button { state.forward() } label: { barLabel("Forward", systemImage: "chevron.forward") }
      .disabled(!state.canGoForward)
      .help("Forward to the next page")
      .accessibilityLabel("Next page")
      .accessibilityIdentifier("browser-forward")
      .aglynBarButtonStyle()
  }

  private var reload: some View {
    Button { state.reload() } label: {
      barLabel(state.loading ? "Stop" : "Reload", systemImage: state.loading ? "xmark" : "arrow.clockwise")
    }
    .help(state.loading ? "Stop loading" : "Reload this page")
    .accessibilityIdentifier("browser-reload")
    .aglynBarButtonStyle()
  }

  private var menu: some View {
    Menu {
      Button {
        AglynSystemBrowser.open(current)
      } label: {
        Label("Open in browser", systemImage: "safari")
      }
      .accessibilityIdentifier("browser-open-browser")
      Button {
        AglynClipboard.copy(current.absoluteString)
      } label: {
        Label("Copy link", systemImage: "link")
      }
      .accessibilityIdentifier("browser-copy")
      ShareLink(item: current) {
        Label("Share…", systemImage: "square.and.arrow.up")
      }
      .accessibilityIdentifier("browser-share")
    } label: {
      barLabel("More", systemImage: "ellipsis.circle")
    }
    #if os(macOS)
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .fixedSize()
    #endif
    .help("Open in browser, copy or share this page")
    .accessibilityIdentifier("browser-menu")
  }
}

/// The WKWebView behind the browser screen: a non-persistent store, so nothing
/// the page sets outlives the screen, and every non-web link handed to the
/// system.
struct AglynWebView {
  let url: URL
  let state: AglynBrowserState

  @MainActor
  func makeWebView(_ coordinator: Coordinator) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = coordinator
    view.uiDelegate = coordinator
    #if os(macOS)
      view.allowsBackForwardNavigationGestures = true
    #else
      // The edge swipe is the system's back gesture, which leaves the screen; the bar's buttons walk the page's history.
      view.allowsBackForwardNavigationGestures = false
    #endif
    state.attach(view)
    view.load(URLRequest(url: url))
    return view
  }

  func makeCoordinator() -> Coordinator { Coordinator() }

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    @MainActor
    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
      guard let url = action.request.url else { return decisionHandler(.allow) }
      if AglynWebPage.isWebPage(url) || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
        return decisionHandler(.allow)
      }
      // mailto:, tel:, an App Store link: the system's.
      AglynSystemBrowser.open(url)
      decisionHandler(.cancel)
    }

    /// A link that asks for a new window opens in this one.
    @MainActor
    func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
      windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if action.targetFrame == nil, let url = action.request.url { webView.load(URLRequest(url: url)) }
      return nil
    }
  }
}

#if os(iOS)
  extension AglynWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateUIView(_ view: WKWebView, context: Context) {}
  }
#elseif os(macOS)
  extension AglynWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateNSView(_ view: WKWebView, context: Context) {}
  }
#endif

/// Answers every address opened under this view (`openURL`, `Link`, a
/// Markdown link): a plain web page goes to `open`, a provider's sign-in or
/// account step to the secure browser, and mail, phone and app links to the
/// system.
struct AglynBrowserHost: ViewModifier {
  let open: @MainActor (AglynWebPage, AglynBrowserDisposition) -> Void
  @Environment(\.webAuthenticationSession) private var webAuthentication

  func body(content: Content) -> some View {
    content.environment(
      \.openURL,
      OpenURLAction { url in
        switch AglynWebPage.destination(url) {
        case .system: return .systemAction
        case .secure:
          let session = webAuthentication
          Task { await session.openHostedPage(url) }
          return .handled
        case .inApp:
          open(AglynWebPage(url), .current)
          return .handled
        }
      }
    )
  }
}

/// Pushes every plain web page opened under this view onto the navigation
/// stack it sits in, as an `AglynBrowserScreen`: for a sheet's own stack, or a
/// screen with no shell navigation of its own.
struct AglynBrowserDestination: ViewModifier {
  @State private var page: AglynWebPage?

  func body(content: Content) -> some View {
    content
      .modifier(AglynBrowserHost { opened, _ in page = opened })
      .navigationDestination(item: $page) { AglynBrowserScreen($0) }
  }
}

extension View {
  /// Plain web pages opened under this view go to `open` (the shell pushes them onto its stack, see
  /// `AglynBrowserScreen`); a provider's sign-in step opens in the secure browser and anything else in the system.
  public func aglynBrowserHost(open: @escaping @MainActor (AglynWebPage, AglynBrowserDisposition) -> Void) -> some View {
    modifier(AglynBrowserHost(open: open))
  }

  /// Plain web pages opened under this view are pushed onto the navigation stack it sits in. Apply it to the root of
  /// a sheet's `NavigationStack`.
  public func aglynBrowserDestination() -> some View { modifier(AglynBrowserDestination()) }
}

/// A navigation stack for a screen that has none (the sign-in, before there is
/// a shell), with no bar of its own until a web page is pushed onto it.
public struct AglynBrowserStack<Content: View>: View {
  let content: Content

  public init(@ViewBuilder content: () -> Content) { self.content = content() }

  public var body: some View {
    NavigationStack {
      content
        .aglynBrowserDestination()
        #if os(iOS)
          .toolbar(.hidden, for: .navigationBar)
        #endif
    }
  }
}

extension View {
  /// The Mac's plain title-bar button (the face draws itself); the system's elsewhere.
  @ViewBuilder
  func aglynBarButtonStyle() -> some View {
    #if os(macOS)
      buttonStyle(.plain)
    #else
      self
    #endif
  }
}
