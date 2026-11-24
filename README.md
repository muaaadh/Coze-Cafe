# Cozé Coffee Club: website and club card demo

A working preview for Cozé Coffee Club (Maafannu, Malé): a public site, a loyalty card for members and a counter tool for staff.

| Page | What it is |
| --- | --- |
| `index.html` | The public site: drinks, this week's offers, menu, where to find the café, and the club card pitch. |
| `club/` | The member's club card: stamps, rewards, personal notes, their usual, privacy controls. Works as a home-screen app. |
| `staff/` | The staff counter: find a member, add a stamp, give a reward, send a personal note, edit this week's offers. Demo passcode `2026`. |

## How the demo works

There is no server. Everything is stored in the visitor's own browser (`localStorage`), so:

- Open the member card in one tab and the staff counter in another tab **of the same browser**. Add a stamp at the counter and the card reacts straight away.
- Two different phones do not see each other's data. That needs the real backend.
- "Reset demo data" in the staff settings puts everything back.

Notifications are real browser notifications once the member turns them on. In this demo they are raised by the page itself when a note arrives; the live version sends them from a server so they arrive when the app is closed.

## Files

```
index.html              public site
club/                   member card app (index.html, club.css, club.js, manifest)
staff/                  staff counter (index.html, staff.css, staff.js)
sw.js                   service worker: only handles notifications, caches nothing
assets/css/base.css     colours, type, buttons, stickers, form controls (shared)
assets/css/site.css     public site layout
assets/js/store.js      the single source of truth: menu, prices, members, stamps, rewards, notes, offers
assets/js/ui.js         small DOM helpers (elements, icons, stickers, QR, toast)
assets/js/brand.js      generated sprite: wordmark, sticker shapes, icons
assets/js/site.js       public site behaviour
assets/vendor/qrcode.js QR code generator by Kazuhiko Arase (MIT)
assets/img/             photos and icons
```

Prices, opening hours, members and offers are samples. Change them in `assets/js/store.js` only, and bump `VERSION` there when the sample data changes.

No build step: open `index.html`, or serve the folder with any static server.
