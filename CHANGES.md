# MaurerFunds 1.1 Changes

Last updated: 2026-11-22

Live Worker: https://maurerfunds.robertmaurer28.workers.dev

Current deployed version: `04e1d057-f818-4589-a5f3-7b2c185c93a0`

## Summary

Version 1.1 adds user accounts and private portfolios to MaurerFunds. Users register with an email address and password, sign in with that same email address, and only see their own holdings, transactions, cash balance, and analysis data.

Authentication is custom (not OAuth). Registration is open, and every new account starts with an empty portfolio. Existing unassigned database rows remain in place but are hidden from all user accounts because every API query is now scoped by `user_id`.

## What changed

### Authentication and sessions

- Added a `users` table with `id`, `email`, `password_hash`, and `created_at`.
- Added password hashing with PBKDF2-SHA256, a random 16-byte salt, and 100,000 iterations. The previous value of 150,000 was reduced because the Cloudflare Workers WebCrypto runtime rejects PBKDF2 iteration counts above 100,000 (`src/worker.js:3`).
- Added a constant-time comparison for stored password hashes.
- Added a dummy hash path on login so nonexistent emails still perform a hash computation.
- Added an HMAC-signed session cookie named `mf_session`:
  - `HttpOnly`
  - `SameSite=Lax`
  - `Secure` outside localhost
  - 7-day lifetime
- The Worker now requires a `SESSION_SECRET` binding. If it is missing, `/api/auth/*` returns HTTP 500 with `Session secret is not configured on the server.`
- Added same-origin protection for `POST`, `PUT`, `PATCH`, and `DELETE` API requests.

New auth endpoints in `src/worker.js:489`:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/me` | Return the signed-in user or 401 |
| `POST` | `/api/auth/register` | Create an account and set a session cookie |
| `POST` | `/api/auth/login` | Verify credentials and set a session cookie |
| `POST` | `/api/auth/logout` | Clear the session cookie |

### Private portfolios

Every portfolio API call now uses the authenticated user's ID:

- Holdings are read, created, updated, and deleted with `user_id` filtering.
- Transactions are read with `user_id` filtering.
- Cash balance and portfolio analysis are calculated from the signed-in user's rows only.
- Sell and delete operations check ownership before changing data.
- The user ID is derived from the signed session, not from the request body.

The main scoping starts at `src/worker.js:688`.

### Database schema and legacy compatibility

`migrations/0001_auth_and_user_scoping.sql` now creates the expected schema idempotently:

- `users`
- `holdings` with `user_id`
- `transactions` with `user_id`, `type`, `amount`, `date`, and `is_initial`

The deployed D1 database was older than the current code. Its `transactions` table originally had these columns:

- `transaction_type`
- `transaction_date`
- `ticker TEXT NOT NULL`

It did not have `type`, `amount`, `date`, or `is_initial`. This caused the add-holding error `d1_error table transactions has no column named type`.

The Worker now repairs legacy databases at runtime before handling API requests (`src/worker.js:111`):

- Inspects table columns with `PRAGMA table_info`.
- Adds `user_id` to `holdings` and `transactions` if missing.
- Adds `type`, `amount`, `date`, and `is_initial` to `transactions` if missing.
- Backfills `type` from `transaction_type` when available.
- Backfills `date` from `transaction_date` when available.
- Creates indexes on `holdings(user_id)` and `transactions(user_id)`.

Transaction writes now go through `insertTransaction` (`src/worker.js:62`), which writes both the current column names and legacy column names when the legacy columns exist. This avoids `NOT NULL constraint failed: transactions.transaction_type`.

Cash transactions now use an empty string for `ticker` instead of `NULL`, because legacy `ticker` is `NOT NULL`. The frontend displays an empty ticker as `-`.

### Frontend

Added a sign-in/sign-up screen and wired it into the existing app shell:

- Login and registration share one form with a toggle.
- Auth errors are shown inline.
- The signed-in email appears in the header.
- Added a Sign out button.
- `initApp()` calls `/api/auth/me` before loading portfolio data.
- `authFetch()` sends unauthenticated responses back to the auth screen.
- Signing out clears the local holding cache and destroys the portfolio chart.

Key frontend changes are in:

- `public/index.html`
- `public/app.js`
- `public/styles.css`

### Tooling and deployment

- `package.json` version is now `1.1.0`.
- Added scripts:
  - `npm run dev` → `wrangler dev`
  - `npm run deploy` → `wrangler deploy`
- Added `wrangler` as a dev dependency.
- Added `.dev.vars` to `.gitignore`.
- No GitHub Actions workflow exists in this repository, so pushing to GitHub does not automatically deploy this code unless Workers Builds is configured outside the repo.
- Deployment was performed with Wrangler.
- Cloudflare secrets currently configured on the Worker:
  - `EULERPOOL_API_KEY`
  - `SESSION_SECRET`

`SESSION_SECRET` was set with:

```powershell
npx wrangler secret put SESSION_SECRET
```

The secret value is intentionally not stored in this repository.

For local development, create an ignored `.dev.vars` file with local values for `SESSION_SECRET` and `EULERPOOL_API_KEY`, then run:

```powershell
npm install
npm run dev
```

## Problems found and fixed during rollout

| Error | Cause | Fix |
| --- | --- | --- |
| `d1_error no such table: user: sqlite_error` | D1 migration had not been applied | Runtime schema creation via `ensureSchema(env)` |
| `Session secret is not configured on the server` | `SESSION_SECRET` was not bound to the deployed Worker | Set the secret with Wrangler |
| `Pbkdf2 failed: iteration counts above 100000 are not supported` | Workers WebCrypto limit | Reduced PBKDF2 iterations from 150,000 to 100,000 |
| `table transactions has no column named type` | Legacy D1 schema used `transaction_type` | Runtime column repair and backfill |
| `NOT NULL constraint failed: transactions.transaction_type` | Inserts only populated the new column | Schema-aware `insertTransaction` writes both column sets |
| `NOT NULL constraint failed: transactions.ticker` | Legacy `ticker` is `NOT NULL`; deposits used `NULL` | Deposits/withdrawals use `''` |

## Verification performed

- JavaScript bracket checks passed for `src/worker.js` and `public/app.js`.
- `/api/auth/me` without a cookie returns HTTP 401.
- Invalid login returns HTTP 401 instead of HTTP 500.
- Throwaway-user tests on the deployed Worker:
  - Add holding: HTTP 200
  - Delete holding: HTTP 200
  - Cash deposit: HTTP 200 and correct cash balance
- All throwaway users and their test rows were removed from D1.
- The live D1 `transactions` table was checked after schema repair and contains both legacy and current columns.

## Repository state

Committed:

- `1231a8b Add user sign-in and private portfolios`
- `6d54c20 Fix sign-up when D1 migration was not applied`
- `484bb64 Bump version to 1.1.0`

Not committed at the time this file was written:

- `src/worker.js` — PBKDF2 limit fix and legacy D1 compatibility fixes
- `package-lock.json` — generated by `npm install`
- `public/web.xml` — pre-existing untracked servlet descriptor, unrelated to the Worker app

The currently deployed Worker includes the uncommitted `src/worker.js` fixes. If deployment is later switched to GitHub-based deploys, commit and push those changes first.
