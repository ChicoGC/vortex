# vortex

Low budget project, hope yall enjoy tho :v

## Layout

```
vortex/
├── web/            # the product UI — static html + css + js, no build step
├── backend/        # Express API
├── frontend/       # Vite + React scaffold (unused so far)
└── dev-server.js   # zero-dependency static server for web/
```

## Running the UI

```bash
node dev-server.js
```

Then open <http://localhost:4180>. There is no build and no install step — `web/`
is plain HTML, CSS and JavaScript, so you can also open `web/index.html`
straight from disk.

## What is in `web/`

Nine views behind a hash router (`#/home`, `#/feed`, …): Home, Feed, Friends,
Activity, Music, Profile, Appearance, Experimental and Settings. All data is
mock data in `js/data.js`, shaped like the API responses we expect later.

```
web/
├── index.html
├── css/
│   ├── tokens.css      # design tokens — primitives + semantic layer per theme
│   ├── base.css        # reset, type ramp, app shell, ambient backdrop
│   ├── components.css  # buttons, panels, rows, overlays, …
│   └── views.css       # sidebar, per-view layout, responsive
└── js/
    ├── icons.js        # inline SVG icon set
    ├── data.js         # mock data
    ├── views.js        # one render function per view
    └── app.js          # routing, theme, player, overlays, events
```

### Design system

Tokens live in `css/tokens.css` in two layers. **Primitives** are raw values
(`--ember-500`, `--space-16`) and are never referenced by components.
**Semantic** tokens (`--accent-base`, `--glass-panel`, `--text-secondary`) are
redefined under `[data-theme="light"]`, so theming is one attribute on `<html>`.

- **Type** — Geist for UI, Geist Mono for anything numeric, so figures align in
  columns. The ramp is the `.t-*` classes in `base.css`.
- **Glass** — panels use `backdrop-filter` plus a 1px inner highlight and layered
  ambient shadows (`--elev-panel` / `--elev-raised` / `--elev-overlay`). The soft
  drifting lights behind them live in `.ambient`; without something back there,
  glass has nothing to refract.
- **Accent** — ember (`#FF5C35`). Used sparingly: the active nav item is carried
  by raised glass, a hairline and a 2.5px rail, not by a saturated fill.
- **Gradients** — permitted only inside album artwork, never in UI chrome.

The same tokens, type ramp and components also exist as a Figma library:
[vortex — Product UI & Design System](https://www.figma.com/design/gUj6oOivWZ83koqwWNiqy2).

### Keyboard

| Shortcut | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` / `/` | Command palette |
| `Esc` | Close palette or modal |

## Backend

```bash
cd backend
npm install
cp .env.example .env    # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npm run dev
```

## Status

The UI is a working prototype with mock data. Not wired up yet: Spotify OAuth,
Supabase reads and writes, and the Experimental login screen (deliberately a
visual prototype — it submits nothing).

## 🇧🇷❗
