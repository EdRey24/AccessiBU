# AccessiBU

Real-time, crowdsourced campus hazard navigation for Boston University. Report
a hazard with a photo, get an AI-assigned severity, and see it pinned on a 3D
campus map and the exact 2D floor plan.

- **Frontend:** Expo (React Native) — runs on web, iOS, and Android
- **Backend:** FastAPI + PostgreSQL

---

## ⚠️ First-time setup (read this — it's why the app "doesn't load")

The app needs a **Mapbox token** to render the map. That token lives in a
`.env` file which is **gitignored**, so a fresh clone has no token and the map
comes up blank. Create it before running:

```bash
cp .env.example .env
```

Then open `.env` and set `EXPO_PUBLIC_MAPBOX_TOKEN` to a Mapbox public token
(free at https://account.mapbox.com/access-tokens/). Ask a teammate for the
shared project token if you don't want to make your own.

---

## Option A — Run everything with Docker (recommended)

One command brings up the web app, the backend, and a Postgres database. You
only need Docker Desktop installed — no Node, Python, or Postgres setup.

```bash
cp .env.example .env     # then fill in EXPO_PUBLIC_MAPBOX_TOKEN
docker compose up --build
```

Open:

- Web app: http://localhost:8081
- Backend API docs: http://localhost:8000/docs

To stop: `Ctrl+C`, then `docker compose down`.

---

## Option B — Run the web app directly (no Docker)

Requires **Node 22**. If you use `nvm`: `nvm use` (see `.nvmrc`).

```bash
cp .env.example .env     # then fill in EXPO_PUBLIC_MAPBOX_TOKEN
npm install
npm run web
```

Open the printed URL (usually http://localhost:8081). Press `w` if it doesn't
open automatically.

### Running on a phone / simulator

```bash
npm run ios        # iOS simulator (macOS + Xcode)
npm run android    # Android emulator (Android Studio)
```

Native builds use the Mapbox SDK, which needs a dev build (`expo run:ios` /
`expo run:android`) rather than Expo Go.

---

## Backend only (no Docker)

Requires **Python 3.12** and a running Postgres.

```bash
cd backend
cp .env.example .env     # set DATABASE_URL + JWT_SECRET
pip install -e .
alembic upgrade head
uvicorn app.main:app --reload
```

---

## Troubleshooting

- **Map is blank / grey / "map doesn't load":** `EXPO_PUBLIC_MAPBOX_TOKEN` is
  missing or invalid in `.env`. Run `cp .env.example .env`, paste the token,
  then **restart** the dev server (env vars are only read at startup).

- **"Requiring unknown module 820" (or any number):** this is a stale Metro
  bundler cache, not a missing package. It happens after pulling new code or
  switching branches. Fix:

  ```bash
  npm run web:clean       # restarts with a cleared cache
  ```

  If it persists, do a full cache wipe:

  ```bash
  npm run clean           # removes .expo + Metro cache
  npm run web:clean
  ```

- **`npm install` fails or behaves oddly:** make sure you're on Node 22
  (`node --version`; `nvm use` if you have nvm). For a clean, lockfile-exact
  install: `rm -rf node_modules && npm ci`.

- **Changes to `.env` not picked up:** env vars are read at startup; stop and
  restart the dev server (or `docker compose up` again).

- **Port already in use:** stop whatever is on 8081/8000/5432, or change the
  host port in `docker-compose.yml`.
