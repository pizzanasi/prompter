# Prompter

A see-through teleprompter overlay for Windows. The script floats above every other window with an adjustable-opacity background, and you drive it from the keyboard. The interface is available in English and Bahasa Indonesia.

**Try the web version:** https://prompter.tintapenari.workers.dev

*Bahasa Indonesia ada di bawah.*

## Features

- Transparent, always-on-top window, so you can read over your camera app, Zoom or OBS
- Background color and opacity (0–100%)
- Text size, line spacing, width, font, weight, alignment, color and shadow
- Reading guide line with an adjustable position, fade at the top and bottom, and mirror mode for teleprompter glass
- **Hide from screen sharing & recording**: you can still read it, but screen recorders and screen shares can't see it
- Paste your script in the editor or drop a `.txt` file onto the window
- Script, settings and window position are saved between sessions

## Run it

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

On Windows you can also double-click `Prompter.vbs` (after `npm install`) to open it without a terminal window.

## Keyboard

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `↓` / `↑` | While playing: faster / slower. While paused: move one line |
| `→` / `←` | Next / previous paragraph |
| `PgUp` / `PgDn` | Move one screen |
| `Home` / `End` | Start / end of script |
| `+` / `−` | Bigger / smaller text |
| `M` | Mirror |
| `E` | Edit script |
| `S` | Settings |
| `L` | Switch language |
| `H` | Show all shortcuts |

Move the window by dragging its top edge. Resize it by dragging a side or the bottom-right corner.

## In a browser

The `web/` folder is the whole interface and also runs as a plain web page ([live here](https://prompter.tintapenari.workers.dev)). Scrolling, the keyboard controls, settings and both languages all work there, plus fullscreen (`F`) and finger-dragging on phones and tablets. Browsers can't draw a see-through window over other apps, though, so transparency, always-on-top and hiding from recordings are desktop-only. The exception is an **OBS Browser Source**: OBS renders the page transparently, so the background opacity works there.

The web version is hosted on Cloudflare Workers (static assets from `web/`):

```bash
npm run web      # local preview
npm run deploy   # publish
```

## Project layout

- `web/`: the interface (HTML, CSS, JS, translations), shared by the desktop app and the website
- `main.js`, `preload.js`: the Electron desktop window (transparency, always-on-top, resizing, hide-from-capture)
- `wrangler.jsonc`: Cloudflare config for the web version

---

## Bahasa Indonesia

Teleprompter overlay tembus pandang buat Windows. Naskahnya melayang di atas semua window lain, opacity background-nya bisa diatur, dan semuanya bisa dikontrol pake keyboard. Bahasa interface bisa Indonesia atau English (tekan `L` atau lewat Pengaturan).

**Versi web:** https://prompter.tintapenari.workers.dev. Di web, tembus pandang ke app lain, selalu di atas, dan sembunyi dari rekaman nggak bisa dipake. Fitur itu cuma ada di versi desktop.

### Cara jalanin

Butuh [Node.js](https://nodejs.org) versi 18 ke atas.

```bash
npm install
npm start
```

Di Windows bisa juga double-click `Prompter.vbs` (setelah `npm install`) biar kebuka tanpa jendela terminal.

### Kontrol

- `Spasi`: jalan / jeda
- `↓` / `↑`: pas jalan bikin makin cepet / makin pelan, pas jeda geser 1 baris
- `→` / `←`: loncat ke paragraf berikutnya / sebelumnya
- `+` / `−`: besarin / kecilin teks
- `E` edit naskah · `S` pengaturan · `L` ganti bahasa · `H` semua shortcut

Di Pengaturan ada opsi **Sembunyiin dari screen share & rekaman layar**. Kalau nyala, prompter tetep keliatan di layar lo tapi nggak ikut kerekam.
