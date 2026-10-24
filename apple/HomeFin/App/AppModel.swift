import Foundation
import HomeFinKit
import Observation
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Everything the app knows about where it is and who's watching.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        /// Signed out: the poster mosaic and Sign In.
        case welcome
        /// Ask for the server address.
        case server
        /// Email + password (Home Fin accounts) or Jellyfin username + password.
        case signIn
        /// Who's watching?
        case profiles
        case main
    }

    var phase: Phase = .launching
    var server: URL?
    var serverName = "Home Fin"
    /// The server runs the Home Fin accounts service (email sign-in and profiles).
    var accountsEnabled = false
    /// Signed in to a Home Fin account (by its cookie).
    var me: HomeFinMe?
    var avatars: [String: AvatarPreset] = [:]
    private(set) var session: SavedSession?
    /// Signed in, but the server can't be reached: only downloads work.
    var isOffline = false

    /// The title page being shown (a sheet over everything, as on Netflix).
    var detail: Item?
    /// What the player shows; set with `play(_:)`.
    var nowPlaying: Item?
    /// The player opens over the title page when it was started from there.
    var playerOverDetail = false
    /// Bumped when something changes what Home shows (thumbs, My List, a finished episode).
    var homeRevision = 0
    /// Titles in a Top 10 row today (the little red TOP 10 badge on posters).
    var top10Ids: Set<String> = []
    /// Films and series added recently, for the bell.
    var arrivals: [Item] = []
    var unseenArrivals = 0

    let device: DeviceIdentity
    let preferences = Preferences()
    let network = NetworkStatus()
    let downloads = DownloadManager()
    private let store: SessionStore
    private let defaults = UserDefaults.standard

    init() {
        device = DeviceIdentity(id: DeviceIdentity.persistentID(), name: Self.deviceName(),
                                version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0")
        #if canImport(Security)
        store = SessionStore(secrets: KeychainSecretStore())
        #else
        store = SessionStore(secrets: MemorySecretStore())
        #endif
    }

    private static func deviceName() -> String {
        #if os(iOS)
        return UIDevice.current.model
        #else
        return Host.current().localizedName ?? "Mac"
        #endif
    }

    // MARK: clients

    var jellyfin: JellyfinClient? {
        guard let session else { return nil }
        return JellyfinClient(server: session.server, device: device, token: session.token, userId: session.userId)
    }

    /// The accounts service, as the current viewer (their Jellyfin token rides along).
    var accounts: AccountsClient? {
        guard let server, accountsEnabled, !isOffline else { return nil }
        return AccountsClient(server: server, jellyfinToken: session?.token)
    }

    /// Artwork before signing in (the profile picker, the welcome mosaic).
    var publicJellyfin: JellyfinClient? {
        server.map { JellyfinClient(server: $0, device: device) }
    }

    var userId: String? { session?.userId }
    var viewerName: String { session?.viewerName ?? "" }
    var isAdmin: Bool { session?.isAdministrator == true || me?.account.isAdmin == true }
    var currentProfile: HomeFinProfile? { session?.profile }

    /// The streaming cap for the connection we're on right now.
    var maxBitrate: Int? {
        preferences.maxBitrate(onMobileData: network.isExpensive)
    }

    // MARK: start-up

    func start() async {
        if let saved = store.load() {
            session = saved
            server = saved.server
            await loadServerDetails(saved.server)
            do {
                _ = try await jellyfin?.currentUser()
                if accountsEnabled { me = try? await AccountsClient(server: saved.server).me() }
                await enterMain()
                return
            } catch let error as HomeFinError where error.isUnauthorized {
                // A revoked token or disabled account: sign in again.
                session = nil
                store.clear()
            } catch {
                // No connection: downloads still play.
                if !downloads.records(for: saved.userId).isEmpty {
                    isOffline = true
                    withAnimation(Theme.spring) { phase = .main }
                    return
                }
            }
        }
        if let text = defaults.string(forKey: "homefin.server"), let url = URL(string: text) {
            server = url
            await loadServerDetails(url)
            if accountsEnabled, let me = try? await AccountsClient(server: url).me() {
                self.me = me
                withAnimation(Theme.spring) { phase = .profiles }
                return
            }
        }
        withAnimation(Theme.spring) { phase = .welcome }
    }

    /// Welcome → Sign In: the address first if we don't have one.
    func beginSignIn() {
        withAnimation(Theme.spring) { phase = server == nil ? .server : .signIn }
    }

    /// Try the server again from offline mode.
    func reconnect() async {
        guard let jellyfin else { return }
        if (try? await jellyfin.currentUser()) != nil {
            isOffline = false
            if let server { await loadServerDetails(server) }
            await enterMain()
        }
    }

    private func enterMain() async {
        isOffline = false
        withAnimation(Theme.spring) { phase = .main }
        if let jellyfin { await downloads.sync(with: jellyfin) }
        await refreshArrivals()
    }

    private func loadServerDetails(_ url: URL) async {
        let probe = JellyfinClient(server: url, device: device)
        if let info = try? await probe.publicInfo() { serverName = info.serverName ?? "Home Fin" }
        let config = try? await AccountsClient(server: url).config()
        accountsEnabled = config?.enabled == true
        if let name = config?.serverName { serverName = name }
        if accountsEnabled, avatars.isEmpty, let presets = try? await AccountsClient(server: url).avatars() {
            avatars = Dictionary(uniqueKeysWithValues: presets.map { ($0.key, $0) })
        }
    }

    // MARK: server

    func connect(to text: String) async throws {
        guard let url = normaliseServerAddress(text) else {
            throw HomeFinError(message: "That doesn't look like a server address. Try something like tv.example.com")
        }
        let info = try await JellyfinClient(server: url, device: device).publicInfo()
        server = url
        serverName = info.serverName ?? "Home Fin"
        defaults.set(url.absoluteString, forKey: "homefin.server")
        await loadServerDetails(url)
        withAnimation(Theme.spring) { phase = .signIn }
    }

    func changeServer() {
        Task { await signOut() }
        defaults.removeObject(forKey: "homefin.server")
        server = nil
        withAnimation(Theme.spring) { phase = .server }
    }

    // MARK: sign-in

    func signIn(email: String, password: String) async throws {
        guard let server else { return }
        me = try await AccountsClient(server: server).login(email: email, password: password)
        withAnimation(Theme.spring) { phase = .profiles }
    }

    func signIn(username: String, password: String) async throws {
        guard let server else { return }
        let auth = try await JellyfinClient(server: server, device: device).authenticate(username: username, password: password)
        adopt(auth, profile: nil)
    }

    /// Who's watching? → this profile (with its PIN if locked).
    func choose(_ profile: HomeFinProfile, pin: String? = nil) async throws {
        guard let server else { return }
        if let old = jellyfin { await old.logout() }
        let auth = try await AccountsClient(server: server).profileSession(profileId: profile.id, device: device, pin: pin)
        adopt(auth, profile: profile)
    }

    private func adopt(_ auth: AuthenticationResult, profile: HomeFinProfile?) {
        guard let server else { return }
        let saved = SavedSession(server: server, userId: auth.user.id, token: auth.accessToken, userName: auth.user.name,
                                 isAdministrator: auth.user.isAdministrator, profile: profile)
        store.save(saved)
        session = saved
        homeRevision += 1
        top10Ids = []
        arrivals = []
        Task { await enterMain() }
    }

    func reloadProfiles() async {
        guard let server, accountsEnabled else { return }
        if let fresh = try? await AccountsClient(server: server).me() { me = fresh }
    }

    func switchProfiles() {
        detail = nil
        Task { await reloadProfiles() }
        withAnimation(Theme.spring) { phase = me == nil ? .signIn : .profiles }
    }

    func signOut() async {
        detail = nil
        nowPlaying = nil
        await jellyfin?.logout()
        if let server, accountsEnabled { await AccountsClient(server: server).logout() }
        store.clear()
        session = nil
        me = nil
        isOffline = false
        withAnimation(Theme.spring) { phase = .welcome }
    }

    /// A 401 from Jellyfin mid-session: the token was revoked (password changed, account disabled).
    func handle(_ error: Error) {
        if let error = error as? HomeFinError, error.isUnauthorized, phase == .main {
            store.clear()
            session = nil
            withAnimation(Theme.spring) { phase = me == nil ? .signIn : .profiles }
        }
    }

    func avatar(for profile: HomeFinProfile?) -> AvatarPreset? {
        profile.flatMap { avatars[$0.avatar] }
    }

    // MARK: watching

    /// Opens a title's page. Episodes open their series.
    func show(_ item: Item) {
        let target = item.isEpisode ? Item(id: item.seriesId ?? item.id, name: item.seriesName, type: "Series") : item
        guard detail != nil else {
            detail = target
            return
        }
        // Another title's page is open: let it close before the next one opens.
        detail = nil
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            detail = target
        }
    }

    func play(_ item: Item) {
        if !isOffline, network.isExpensive, preferences.mobileData == .wifiOnly, downloads.localFile(for: item.id) == nil {
            streamingBlocked = true
            return
        }
        playerOverDetail = detail != nil
        nowPlaying = item
    }

    /// Mobile Data Usage is "Wi-Fi Only" and we're on mobile data.
    var streamingBlocked = false

    // MARK: the bell

    private var bellKey: String { "homefin.bellSeen.\(userId ?? "")" }

    func refreshArrivals() async {
        guard let jellyfin, !isOffline else { return }
        let fresh = (try? await jellyfin.arrivals()) ?? []
        let seen = defaults.double(forKey: bellKey)
        arrivals = fresh
        unseenArrivals = fresh.filter { ($0.dateCreatedDate?.timeIntervalSince1970 ?? 0) > seen }.count
    }

    func markArrivalsSeen() {
        defaults.set(Date().timeIntervalSince1970, forKey: bellKey)
        unseenArrivals = 0
    }

    // MARK: welcome mosaic

    /// Poster addresses remembered from the last Home, for the signed-out welcome screen.
    var welcomePosters: [URL] {
        (defaults.stringArray(forKey: "homefin.welcomePosters") ?? []).compactMap(URL.init(string:))
    }

    func rememberPosters(_ urls: [URL]) {
        guard urls.count >= 6 else { return }
        defaults.set(urls.prefix(12).map(\.absoluteString), forKey: "homefin.welcomePosters")
    }
}

extension Item {
    var dateCreatedDate: Date? {
        guard let dateCreated else { return nil }
        let trimmed = dateCreated.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        return ISO8601DateFormatter().date(from: trimmed.hasSuffix("Z") ? trimmed : trimmed + "Z")
    }
}
