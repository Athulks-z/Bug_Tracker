# Professional Upgrade Audit and Plan

## Existing implementation

- The backend is an Express 4 API using Mongoose, JWT, bcryptjs, dotenv, and CORS. It has User, Project, Issue, Task, Sprint, Release, Notification, and IssueTemplate models, plus route modules for those resources.
- The frontend is React 18 using Create React App (`react-scripts`), React Router, a fetch-based API wrapper, local-storage JWT auth, Recharts, date-fns, xlsx, file-saver, and react-hot-toast. The Vite configuration file is present but is not used by the package scripts.
- Render and Vercel deployment configuration exists. Existing environment examples are present in `backend/.env.example` and `frontend/.env.example`.
- The existing data model already stores project ownership/members, issue comments, attachments and activity, task dates, and basic sprint/release records.

## Duplicate frontend files and active imports

CRA resolves extensionless imports using `.js` before `.jsx`. `App.js` imports `Dashboard`, `Issues`, `Tasks`, `AdminUsers`, `AdminProjects`, `Login`, `Register`, `Layout`, and `AuthContext` without extensions, so it selects the `.js` variants where both extensions exist. `Layout.js` also renders `Outlet`; `Layout.jsx` is a separate unused implementation that renders `children` and selects `Sidebar.jsx`.

The `.js` and `.jsx` copies are not identical: they differ in page behavior, API imports, and data assumptions. In particular, active `Dashboard.js`, `Issues.js`, `AdminUsers.js`, and `AdminProjects.js` imported a named `api` export, while `frontend/src/api.js` only exports a default object; those active imports have been corrected in Phase 1. Keep both variants until a later phase verifies imports and consolidates them deliberately.

## Route and navigation mismatches

- Actual routes in `App.js`: `/`, `/issues`, `/tasks`, `/profile`, `/sprints`, `/releases`, `/admin/users`, and `/admin/projects`, with `/` as the dashboard.
- Active navigation in `Layout.js` includes Dashboard, Issues, Tasks, Profile, and admin Users/Projects, but omits Sprints and Releases.
- Unused `Sidebar.jsx` points to `/dashboard`, `/projects`, and `/reports`, which are not registered routes; it omits Tasks, Sprints, Releases, Profile, and Admin Projects.
- `Projects.jsx` and `Reports.jsx` exist but are not mounted by `App.js`. The root dashboard links to `/projects`, which currently has no route.
- The README's endpoint and deployment descriptions do not cover the current expanded routes and files and should be reconciled in the documentation/deployment phase.

## Security and reliability gaps found

- CORS allows every origin when `CLIENT_URL` is unset, while credentials are enabled. Startup only requires `MONGODB_URI`; a missing or weak `JWT_SECRET` is not rejected.
- JWTs expire after seven days; registration remains open after the first account; there is no login/registration throttling, password complexity rule, lockout, token version, or public registration configuration endpoint.
- Issue, task, sprint, release, and project queries are not consistently scoped to project membership. Admin project listing is global, and multiple writes accept request-body fields without route-level allow-lists or validation.
- `backend/server.js` serves the uploads directory publicly. Issue attachments are accepted as base64 without a route-level size/type check. Attachment downloads need authenticated membership checks before the public serving behavior can safely be replaced.
- Several routes return raw exception messages, user updates allow direct password replacement, and the notification helper suppresses storage failures while logging notification details.
- `GET /api/users` exposes all user records to any authenticated user. Notification read updates do not constrain the update by the current user.
- Existing upload handling, access control, ownership checks, project roles, audit events, and the required security tests are incomplete.

## Repository hygiene

- At audit time, no `.env` or `.env.*` file was tracked. Example environment files are tracked as examples and contain placeholders, not deployment credentials.
- The existing ignore files omit some requested build, coverage, upload, distribution, and OS-file patterns. Root ignore rules will cover those consistently while allowing `.env.example`.
- The repository contains literal brace-named directories in addition to the expected source tree; no source files were found there during this audit. They should be checked before any cleanup rather than removed speculatively.

## Delivery order

1. **Phase 1 — Audit, hygiene, and security baseline:** document this audit, create the feature branch, ignore secrets/generated files, validate required startup configuration, add security headers/rate limits/Mongo query sanitization/CORS allow-listing, and restrict public registration.
2. **Phase 2 — Access control:** introduce `getAccessibleProjectIds(user)` and membership checks across every project-derived endpoint, including attachments, exports, search, and aggregations; add access-control tests.
3. **Phase 3 — Design system and layout:** add design tokens and shared UI primitives, then align navigation and responsive layout with actual routes.
4. **Phase 4 — Existing page refactor:** standardize page interactions, loading/empty/error states, and route-specific UI without dropping existing behavior.
5. **Phase 5 — Users and profile:** add secure invites, account state/role protections, password lifecycle, profile fields, and session invalidation.
6. **Phase 6 — Email and jobs:** add notification delivery, preferences, retry handling, scheduled jobs, and protected job endpoints.
7. **Phase 7 — Project information:** extend project metadata and add team, activity, settings, and project tabs.
8. **Phase 8 — Backlog, sprints, and board:** extend existing models additively and add planning, ranking, and board workflows.
9. **Phase 9 — Dashboard, reports, import, tests, docs, and deployment:** finish metrics/export/import, add end-to-end coverage, update environment/deployment documentation, and validate both applications.

Each phase should preserve existing routes and data, run the focused backend/frontend checks, and be committed separately. Phase 1 adds startup configuration checks, security headers, API/auth rate limits, Mongo query sanitization, a `CLIENT_URL` CORS allow-list, registration lockdown, stronger password rules, and repository-wide ignore rules. Access scoping and authenticated attachment download are critical gates before broadening the UI or declaring the application production-ready.
