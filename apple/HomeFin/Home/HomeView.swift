import HomeFinKit
import SwiftUI

/// Home: the billboard, then rows (Continue Watching, Top 10, Because you watched, My List, …).
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @State private var plan: HomePlan?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: compact ? 22 : 34) {
                    if let plan {
                        if let billboard = plan.billboard {
                            BillboardView(billboard: billboard)
                                .transition(.opacity)
                        }
                        ForEach(Array(plan.rows.enumerated()), id: \.element.id) { index, row in
                            RowView(row: row)
                                .modifier(RowReveal(index: index))
                        }
                    } else if let error {
                        ContentUnavailableView {
                            Label("Couldn't load Home", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text(error)
                        } actions: {
                            Button("Try again") { Task { await load() } }.buttonStyle(PrimaryButtonStyle())
                        }
                        .padding(.top, 80)
                    } else {
                        HomeSkeleton()
                    }
                }
                .padding(.bottom, 30)
            }
            .scrollIndicators(.hidden)
            .homeFinBackground()
            .refreshable { await load() }
            .navigationDestination(for: Item.self) { item in
                DetailView(itemId: item.isEpisode ? (item.seriesId ?? item.id) : item.id)
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    if compact { Wordmark(size: 22) }
                }
                #if os(macOS)
                ToolbarItem(placement: .navigation) { Wordmark(size: 22) }
                #endif
            }
            .inlineNavigationTitle()
            .transparentNavigationBar()
        }
        .task(id: model.homeRevision) { await load() }
    }

    private func load() async {
        guard let jellyfin = model.jellyfin else { return }
        do {
            let fresh = try await HomeLoader(jellyfin: jellyfin, accounts: model.accounts).load(viewerName: model.viewerName)
            withAnimation(.easeOut(duration: 0.35)) {
                plan = fresh
                error = nil
            }
        } catch {
            model.handle(error)
            if plan == nil { withAnimation { self.error = error.localizedDescription } }
        }
    }
}

/// Rows rise into place as they first appear (once).
struct RowReveal: ViewModifier {
    var index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 18)
            .onAppear {
                withAnimation(.spring(response: 0.55, dampingFraction: 0.9).delay(min(Double(index), 4) * 0.04)) { shown = true }
            }
    }
}

/// Grey placeholders shimmering while Home loads.
struct HomeSkeleton: View {
    @Environment(\.isCompactLayout) private var compact
    @State private var phase = false

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            RoundedRectangle(cornerRadius: 14)
                .fill(Theme.surface)
                .aspectRatio(compact ? 0.78 : 16 / 7, contentMode: .fit)
                .padding(.horizontal, Theme.gutter)
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    RoundedRectangle(cornerRadius: 4).fill(Theme.surface).frame(width: 180, height: 18)
                    HStack(spacing: 8) {
                        ForEach(0..<6, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: Theme.cardRadius)
                                .fill(Theme.surface)
                                .frame(width: compact ? 110 : 260, height: compact ? 160 : 146)
                        }
                    }
                }
                .padding(.leading, Theme.gutter)
            }
        }
        .opacity(phase ? 1 : 0.5)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { phase = true }
        }
    }
}
