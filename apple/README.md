# Home Fin for iPhone, iPad and Mac

A native SwiftUI app with the same look and feel as the Home Fin web app:
Who's watching?, the billboard, Continue Watching, Top 10, "Because you
watched…", My List, title pages with episodes, search, requests and the admin
approval queue. One app target runs on iPhone, iPad and Mac (native macOS,
not Catalyst).

```
apple/
  project.yml        XcodeGen spec: the Xcode project is generated from this
  HomeFin/           the app (SwiftUI)
    App/             start-up, AppModel (who's signed in, which screen)
    Onboarding/      server address, sign in, Who's watching? + PIN pad
    Home/            billboard and rows
    Detail/          title page, episodes, More Like This
    Player/          AVKit player (PiP, AirPlay, subtitles), progress reporting
    Search/          library search + "Not here yet" requests
    Requests/        your / household requests, admin queue, request sheet
    Settings/        My Home Fin: profile, My List, quality, Sign in a TV
    Theme/           colours, buttons, artwork, rating badges
  HomeFinKit/        Swift package with no UI: Jellyfin + accounts clients,
                     playback plans, the home-screen planner. Has tests.
```

## What you need

* A Mac with Xcode 16 or newer.
* Your Apple Developer account signed in to Xcode (Xcode → Settings → Accounts).
* XcodeGen: `brew install xcodegen`.

## Build and run it on your own devices

```sh
cd apple
xcodegen            # makes HomeFin.xcodeproj (run again after pulling changes)
open HomeFin.xcodeproj
```

1. Click the **HomeFin** project, then the **HomeFin** target, then
   **Signing & Capabilities**. Pick your team. If Xcode says the bundle ID
   `uk.co.levetmedia.homefin` is taken, change it to something of yours
   (also in `project.yml` so it sticks).
2. At the top of the window, pick a run destination: your plugged-in iPhone
   or iPad, a simulator, or **My Mac**. Press ▶︎.
3. On first launch, type your server address, e.g. `http://192.168.55.30:8096`
   at home or your public `https://…` address. Then sign in with your Home Fin
   email (or a Jellyfin username if accounts are off).

The first build is the moment of truth. This app was written without access
to a Mac, so expect a handful of compile errors. They'll be small (a
modifier that's iOS-only, a type the compiler wants spelt out). Paste them
back and they'll be fixed.

## Sending it to friends and family (TestFlight)

TestFlight is Apple's beta app: people install it from the App Store, then
install Home Fin through it. No App Store listing needed.

1. **Create the app record** at [App Store Connect](https://appstoreconnect.apple.com)
   → Apps → **+** → New App. Tick **iOS** and **macOS**, name "Home Fin"
   (pick another if it's taken; this name is only what testers see), and
   choose the bundle ID from step 1 above.
2. **Upload a build.** In Xcode pick **Any iOS Device (arm64)** as the
   destination, then **Product → Archive**. When the Organizer opens:
   **Distribute App → TestFlight & App Store → Distribute**.
   Do it again with **Any Mac** as the destination for the Mac version.
3. **Bump the build number** before every new upload: target → General →
   *Build* (or `CURRENT_PROJECT_VERSION` in `project.yml`). Apple rejects a
   repeated number.
4. **Invite people.** App Store Connect → your app → **TestFlight**:
   * *Internal testing*: up to 100 people on your developer team. No review,
     available minutes after upload.
   * *External testing*: anyone with an email address, or a **public link**
     you can text round the family. The first build gets a short Beta App
     Review (usually within a day). In "Test Information" explain it's a
     personal media-server client and give a test server login, since the
     reviewer needs to get past sign-in.
5. People install **TestFlight** from the App Store (iPhone, iPad or Mac),
   open your invite link, and tap Install. Builds expire after 90 days, so
   upload a fresh one now and then.

Your friends will need a server address they can reach from outside your
house, e.g. your Cloudflare tunnel's `https://` address. `192.168.…` only
works on your home Wi-Fi.

## How it talks to the server

* Jellyfin's API directly for browsing, images and playback. Films and
  episodes in MP4 (H.264 / HEVC) play directly. Everything else (MKV, other codecs)
  is transcoded to HLS by the server, the same as
  the Jellyfin iOS app.
* The Home Fin accounts service (`/homefin-api`) for email sign-in, profiles,
  PINs, trending and requests, when the server has accounts turned on.
* Progress is reported to Jellyfin every 10 seconds, so Continue Watching
  matches the web app and TVs.
* Streaming quality is set in My Home Fin (Auto by default).
* The sign-in token lives in the Keychain. Sign out removes it.

## Testing HomeFinKit

The non-UI code builds and tests anywhere Swift runs, Linux included:

```sh
cd apple/HomeFinKit
swift test                                  # unit tests
HOMEFIN_IT_SERVER=http://127.0.0.1:8097 \
HOMEFIN_IT_USER=admin HOMEFIN_IT_PASS=… \
HOMEFIN_IT_EMAIL=you@example.com HOMEFIN_IT_EMAIL_PASS=… \
swift test                                  # + tests against a real server
```
