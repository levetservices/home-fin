import HomeFinKit
import SwiftUI

/// Phones get Netflix's mobile layout (posters, a tall billboard); iPad and Mac the wide one.
private struct CompactLayoutKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    var isCompactLayout: Bool {
        get { self[CompactLayoutKey.self] }
        set { self[CompactLayoutKey.self] = newValue }
    }
}

/// The signed-in app: Home, Requests, Search and My Home Fin on Netflix's floating tab bar
/// (Liquid Glass on iOS 26, which draws it for us).
struct MainView: View {
    @Environment(AppModel.self) private var model
    @State private var requests: RequestsConfig?
    @State private var tab = Tab.home

    enum Tab: Hashable { case home, requests, search, mine }

    private var showRequests: Bool { requests?.enabled == true || requests?.isAdmin == true }

    var body: some View {
        GeometryReader { proxy in
            Group {
                if model.isOffline {
                    OfflineView()
                } else {
                    tabs
                }
            }
            .environment(\.isCompactLayout, proxy.size.width < 700)
        }
        .task(id: model.session?.token) {
            requests = try? await model.accounts?.requestsConfig()
        }
    }

    private var tabs: some View {
        TabView(selection: $tab) {
            SwiftUI.Tab("Home", systemImage: "house", value: Tab.home) {
                HomeView()
            }
            if showRequests {
                SwiftUI.Tab("Requests", systemImage: "plus.rectangle.on.rectangle", value: Tab.requests) {
                    RequestsView(config: requests)
                }
            }
            SwiftUI.Tab("Search", systemImage: "magnifyingglass", value: Tab.search) {
                SearchView(requests: requests)
            }
            SwiftUI.Tab(value: Tab.mine) {
                MyHomeFinView()
            } label: {
                Label {
                    Text("My Home Fin")
                } icon: {
                    TabAvatar(preset: model.avatar(for: model.currentProfile), name: model.viewerName)
                }
            }
        }
        .tint(.white)
    }
}

/// The viewer's avatar as the last tab's icon (tab bars want an image, so it's rendered once).
struct TabAvatar: View {
    var preset: AvatarPreset?
    var name: String

    var body: some View {
        if let image = rendered {
            image
        } else {
            Image(systemName: "person.crop.square")
        }
    }

    @MainActor private var rendered: Image? {
        let renderer = ImageRenderer(content: AvatarView(preset: preset, name: name, size: 26))
        renderer.scale = 3
        #if os(iOS)
        guard let image = renderer.uiImage else { return nil }
        return Image(uiImage: image.withRenderingMode(.alwaysOriginal))
        #else
        guard let image = renderer.nsImage else { return nil }
        return Image(nsImage: image).renderingMode(.original)
        #endif
    }
}

/// The top of every tab: a title on the left; AirPlay, Downloads and the bell on the right. It
/// stays put while the page scrolls under it.
struct TabHeader<Leading: View>: View {
    @Environment(AppModel.self) private var model
    @ViewBuilder var leading: Leading
    @State private var showDownloads = false
    @State private var showBell = false

    var body: some View {
        HStack(spacing: 6) {
            leading
            Spacer(minLength: 8)
            RoutePickerButton()
                .frame(width: 40, height: 40)
            headerButton("arrow.down.to.line", label: "Downloads") { showDownloads = true }
            headerButton("bell", label: "Notifications") {
                showBell = true
                model.markArrivalsSeen()
            }
            .overlay(alignment: .topTrailing) {
                if model.unseenArrivals > 0 {
                    Text("\(model.unseenArrivals)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Capsule().fill(Theme.brand))
                        .offset(x: 2, y: -1)
                        .transition(.scale.combined(with: .opacity))
                }
            }
        }
        .padding(.horizontal, Theme.gutter)
        .frame(height: 52)
        .animation(Theme.spring, value: model.unseenArrivals)
        .sheet(isPresented: $showDownloads) {
            NavigationStack { DownloadsView(showsClose: true) }
                .environment(model)
                .presentationBackground(.black)
        }
        .sheet(isPresented: $showBell) {
            BellView()
                .environment(model)
                .presentationDetents([.medium, .large])
                .presentationBackground(.black)
        }
    }

    private func headerButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 21, weight: .medium))
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityLabel(label)
    }
}

/// "H Home": the brand mark and the page's name, Netflix-style.
struct BrandTitle: View {
    var title: String

    var body: some View {
        HStack(spacing: 8) {
            BrandMark(size: 34)
            Text(title)
                .font(.system(size: 28, weight: .bold))
                .contentTransition(.opacity)
        }
    }
}

extension View {
    /// Pins a header above scrolling content: on iOS 26 content blurs softly under it (Liquid
    /// Glass's scroll edge), before that it gets a dark material once you scroll.
    @ViewBuilder func pinnedHeader<Header: View>(scrolled: Bool, @ViewBuilder _ header: @escaping () -> Header) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            safeAreaBar(edge: .top) { header() }
                .softScrollEdge()
        } else {
            safeAreaInset(edge: .top, spacing: 0) {
                header()
                    .background {
                        Rectangle().fill(.ultraThinMaterial)
                            .overlay(Color.black.opacity(0.35))
                            .ignoresSafeArea(edges: .top)
                            .opacity(scrolled ? 1 : 0)
                    }
                    .animation(.easeOut(duration: 0.2), value: scrolled)
            }
        }
    }

    /// Reports whether a scroll view has moved past its top.
    func trackScrolled(_ scrolled: Binding<Bool>) -> some View {
        onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top > 8
        } action: { _, value in
            if scrolled.wrappedValue != value { scrolled.wrappedValue = value }
        }
    }
}

/// Signed in but the server can't be reached: Netflix's offline mode, with downloads.
struct OfflineView: View {
    @Environment(AppModel.self) private var model
    @State private var retrying = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "wifi.slash")
                    VStack(alignment: .leading, spacing: 2) {
                        Text("You're offline").font(.system(size: 15, weight: .semibold))
                        Text("Your downloads still play.").font(.system(size: 13)).foregroundStyle(Theme.secondary)
                    }
                    Spacer()
                    Button {
                        retrying = true
                        Task {
                            await model.reconnect()
                            retrying = false
                        }
                    } label: {
                        if retrying { ProgressView() } else { Text("Try Again") }
                    }
                    .buttonStyle(GlassPillButtonStyle(height: 36))
                }
                .padding(14)
                .glass(in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.horizontal, Theme.gutter)
                .padding(.top, 8)
                DownloadsView(showsClose: false)
            }
            .homeFinBackground()
        }
    }
}

/// The bell: what arrived on the server recently.
struct BellView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Notifications").font(.system(size: 22, weight: .bold))
                Spacer()
                GlassCircleButton(systemImage: "xmark", size: 40, label: "Close") { dismiss() }
            }
            .padding(Theme.gutter)
            if model.arrivals.isEmpty {
                ContentUnavailableView("Nothing new yet", systemImage: "bell",
                                       description: Text("New films and series added in the last two weeks show up here."))
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        ForEach(model.arrivals) { item in
                            Button {
                                dismiss()
                                model.show(item)
                            } label: {
                                HStack(spacing: 14) {
                                    Artwork(url: model.jellyfin?.landscapeURL(item, maxWidth: 400), placeholder: item.name)
                                        .frame(width: 128, height: 72)
                                        .clipShape(RoundedRectangle(cornerRadius: 6))
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(item.ribbon() ?? "New Arrival").font(.system(size: 13)).foregroundStyle(Theme.secondary)
                                        Text(item.name ?? "").font(.system(size: 16, weight: .semibold)).lineLimit(2)
                                        Text(Self.ago(item.dateCreatedDate)).font(.system(size: 13)).foregroundStyle(Theme.tertiary)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, Theme.gutter)
                }
            }
        }
        .foregroundStyle(.white)
    }

    static func ago(_ date: Date?) -> String {
        guard let date else { return "" }
        let days = Int(Date().timeIntervalSince(date) / 86_400)
        switch days {
        case ..<1: return "Today"
        case 1: return "Yesterday"
        case 2..<7: return "\(days) days ago"
        default: return days < 14 ? "1 week ago" : "\(days / 7) weeks ago"
        }
    }
}
