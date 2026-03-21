# Pulse

Organizational diagnostic platform: employee Pulse flow and admin analytics. Stack: **Node.js (Express)**, **PostgreSQL**, **React (Vite)**.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+

## Local setup

1. Create a database and copy env:

   ```bash
   cp backend/.env.example backend/.env
   # Edit DATABASE_URL, JWT_SECRET
   ```

2. Install and migrate (from repo root):

   ```bash
   ./build.sh
   ```

   Or manually:

   ```bash
   cd backend && npm install && npm run migrate && npm run seed
   cd ../frontend && npm install && npm run build
   ```

3. **Admin login** (from seed): `hello@lukeford.dev` / `Connor!7`

4. Run API (serves built frontend if `frontend/dist` exists):

   ```bash
   cd backend && npm run dev
   ```

5. For frontend hot reload during development:

   ```bash
   cd frontend && npm run dev
   ```

   Vite proxies `/api` to `http://localhost:3001`. Set `FRONTEND_ORIGIN=http://localhost:5173` in `backend/.env`.

## Render.com

- Create a **PostgreSQL** instance and note `DATABASE_URL`.
- Attach a **persistent disk** and set `STORAGE_PATH` to the mount path (e.g. `/var/data`).
- Web service: root directory repo, build command `./build.sh`, start command `cd backend && npm start`.
- Set env: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `FRONTEND_ORIGIN` (your app URL), `DATABASE_SSL` omit or use defaults.

See [render.yaml](./render.yaml) for a blueprint-style reference.

## API overview

- `POST /api/auth/login` — email/password
- `GET /api/auth/invite/:token` — validate invite
- `POST /api/auth/accept-invite` — `{ token, password }`
- `GET /api/pulse/*` — employee Pulse (JWT, role `employee`)
- `GET|POST /api/admin/*`, `/api/analytics/*` — admin (JWT, role `admin`)

## License

Private / your org.
