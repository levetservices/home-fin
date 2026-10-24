import HomeFinKit
import SwiftUI

/// Netflix's "My Netflix": who's watching, My List, and settings.
struct MyHomeFinView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @AppStorage("homefin.maxBitrate") private var maxBitrate = 0
    @State private var myList: [Item] = []
    @State private var tvCode = ""
    @State private var tvMessage: String?
    @State private var confirmSignOut = false

    private let qualities: [(String, Int)] = [
        ("Auto", 0), ("Best: up to 4K (40 Mbps)", 40_000_000), ("High: 1080p (20 Mbps)", 20_000_000),
        ("Medium: 1080p (8 Mbps)", 8_000_000), ("Low: 720p (3 Mbps)", 3_000_000), ("Data saver (1.5 Mbps)", 1_500_000)
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    profileHeader
                    if !myList.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("My List").font(.system(size: 20, weight: .bold))
                            ScrollView(.horizontal) {
                                LazyHStack(spacing: 8) {
                                    ForEach(myList) { item in
                                        NavigationLink(value: item) { PosterCard(item: item) }.buttonStyle(CardButtonStyle())
                                    }
                                }
                                .padding(.vertical, 4)
                            }
                            .scrollIndicators(.hidden)
                        }
                    }
                    settings
                }
                .padding(Theme.gutter)
                .frame(maxWidth: 820, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .homeFinBackground()
            .navigationTitle("My Home Fin")
            .navigationDestination(for: Item.self) { item in
                DetailView(itemId: item.isEpisode ? (item.seriesId ?? item.id) : item.id)
            }
            .task(id: model.homeRevision) {
                myList = (try? await model.jellyfin?.favourites()) ?? []
            }
            .onChange(of: maxBitrate) { _, value in model.maxBitrate = value == 0 ? nil : value }
            .confirmationDialog("Sign out of Home Fin on this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            }
        }
    }

    private var profileHeader: some View {
        HStack(spacing: 16) {
            AvatarView(preset: model.avatar(for: model.currentProfile), name: model.viewerName, size: 72)
            VStack(alignment: .leading, spacing: 6) {
                Text(model.viewerName).font(.system(size: 24, weight: .bold))
                if model.accountsEnabled && model.me != nil {
                    Button { model.switchProfiles() } label: {
                        Label("Switch profiles", systemImage: "arrow.left.arrow.right")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.secondary)
                }
            }
        }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 14) {
            panel("Playback") {
                Picker("Streaming quality", selection: $maxBitrate) {
                    ForEach(qualities, id: \.1) { Text($0.0).tag($0.1) }
                }
                Text("Higher quality uses more data. Auto picks the best your connection allows.")
                    .font(.caption).foregroundStyle(Theme.secondary)
            }
            panel("Sign in a TV") {
                Text("Pick Quick Connect in the Jellyfin app on your TV or phone, then type the code it shows.")
                    .font(.callout).foregroundStyle(Theme.secondary)
                HStack {
                    TextField("Code", text: $tvCode)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 160)
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                    Button("Sign in") { authorizeTV() }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(tvCode.count < 6)
                }
                if let tvMessage { Text(tvMessage).font(.callout).transition(.opacity) }
            }
            panel("About") {
                LabeledContent("Server", value: model.serverName)
                LabeledContent("Address", value: model.server?.host() ?? "")
                LabeledContent("App", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
            }
            Button(role: .destructive) { confirmSignOut = true } label: {
                Text("Sign out").frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle())
            .padding(.top, 6)
        }
    }

    private func panel<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 17, weight: .bold))
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface))
    }

    private func authorizeTV() {
        let code = tvCode
        Task {
            do {
                try await model.jellyfin?.authorizeQuickConnect(code: code)
                withAnimation { tvMessage = "Done. The TV is signing in as \(model.viewerName)." }
                tvCode = ""
            } catch {
                withAnimation { tvMessage = "That code didn't work. Codes expire after a few minutes; try a new one." }
            }
        }
    }
}
