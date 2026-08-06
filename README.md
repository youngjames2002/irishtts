# irishtts

Rankings site for the Irish Tekken/TTS scene: a FastAPI backend over Postgres plus a
static frontend, with start.gg integration for pulling event entrant data.

## Layout

- `main.py` — FastAPI app: events, players, tiers, seasons, and the start.gg lookup endpoint.
- `public/` — static frontend (vanilla JS) with swappable themes.

## Running locally

```sh
python -m venv venv
venv/Scripts/activate      # or: source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env       # then fill in the values
uvicorn main:app --reload
```

The app reads all secrets from the environment (via `.env` in development, or the
service environment in production) and refuses to start if any are missing. See
`.env.example` for the full list.

The frontend expects the API to be served under `/api` on the same origin — in
production a reverse proxy serves `public/` as the site root and forwards `/api`
to uvicorn.

## Notes

- Admin access is a single shared password; `POST /auth` exchanges it for a bearer
  token that is regenerated on every process restart, so restarting logs admins out.
- `POST /seasons/new` wipes events, players, and tiers after snapshotting them into
  `seasons`. It requires both the bearer token and the password.
