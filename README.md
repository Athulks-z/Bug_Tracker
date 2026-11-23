# BugTracker

A bug tracker built with React, Node.js, Express, and PostgreSQL storage.

## Features

- JWT login and registration; the first account in an empty database becomes super admin
- Five-role access control: super admin, admin, manager, employee, and trainee
- Issue management, comments, attachments, activity, search, filters, and CSV export
- Projects and team membership
- Admin user management
- Dashboard, reports, tasks, sprints, releases, notifications, and issue templates

## PostgreSQL setup

The backend requires a PostgreSQL database. Copy `backend/.env.example` to `backend/.env` and set either `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Also set `JWT_SECRET` to a random value of at least 32 characters and configure `CLIENT_URL`.

Run database migrations from the repository root before starting the API:

```powershell
npm --prefix backend install
npm --prefix backend run db:migrate
npm --prefix backend run db:migrate:normalized
npm --prefix backend run dev
```

The API reads and writes normalized PostgreSQL tables while preserving the existing API record shapes. `db:migrate:normalized` validates and converts the transitional `app_records` data in one transaction, verifies row counts, then renames that source table to `app_records_legacy`, which is preserved but not used by runtime storage. It will refuse cutover if references are invalid or normalized target tables already contain data. Legacy issue records without a type are explicitly mapped to `other`; memberships from both legacy arrays are combined. For the current development data, each side had two memberships with no overlap; the approved union is four. The database contains four users, one project, and two issues. The original Google Sheet was not modified.

`db:migrate:sheets` is a legacy first-stage importer for databases that still have an empty `app_records` compatibility table. Do not run it after normalized cutover; the original imported records are preserved in `app_records_legacy`.

## Local development

Prerequisites: Node.js 18+ and a PostgreSQL database.

1. Copy `backend/.env.example` to `backend/.env` and fill in the PostgreSQL connection settings.
2. From the repository root, run the migration and start commands above. The API listens on `http://localhost:5000`.
3. In `frontend`, set `REACT_APP_API_URL=http://localhost:5000/api`, run `npm install`, and run `npm start`.
4. Open `http://localhost:3000/register`. On an empty database, the first account becomes super admin; an imported database keeps its existing accounts.

## Roles and project permissions

| Role | Permissions |
|---|---|
| Super admin | Full access; may assign any role, manage departments and global settings, and manage all projects and work items |
| Admin | Manage users except super-admin accounts or assignments; manage all projects and work items |
| Manager | Manage work and project membership within projects they belong to; no role or global-setting management |
| Employee | Access assigned projects; create/update work items they reported or are assigned; comment and log time |
| Trainee | Read-only access to assigned projects and work items |

Department-based scopes are not currently populated. Manager, employee, and trainee project access is therefore based on project ownership and membership. Self-registration creates employee accounts after the initial super-admin account.

## Render deployment

The repository includes `render.yaml`. Configure `DATABASE_URL`, `CLIENT_URL`, and `REACT_APP_API_URL` in Render. The backend runs versioned migrations before startup; use a PostgreSQL connection string available to the backend service and keep it in the platform's secret settings.

## Project structure

```text
backend/
  middleware/     JWT authentication and admin authorization
  routes/         Express API routes
  db/             Versioned schema and normalized data migrations
  services/       Normalized PostgreSQL store and record helpers
  server.js       API entry point
frontend/
  src/            React application
render.yaml       Render deployment configuration
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register (first user becomes admin) |
| POST | `/api/auth/login` | Sign in and receive a JWT |
| GET/PUT | `/api/auth/me` | Read or update the current profile |
| GET/POST/PUT/DELETE | `/api/users` | Admin user management |
| GET/POST/PUT/DELETE | `/api/projects` | Project management |
| GET/POST/PUT/DELETE | `/api/issues` | Issue management |
| POST | `/api/issues/:id/comments` | Add an issue comment |
| GET/POST/PUT/DELETE | `/api/tasks` | Task management |
| GET/POST/PUT/DELETE | `/api/sprints` | Sprint management |
| GET/POST/PUT/DELETE | `/api/releases` | Release management |
| GET/POST/PUT/DELETE | `/api/templates` | Issue template management |
| GET/PUT | `/api/notifications` | Read and update notifications |
