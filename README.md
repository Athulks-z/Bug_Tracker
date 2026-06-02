# BugTracker — Production-Ready Full Stack App

A full-featured bug tracker similar to Zoho BugTracker. Built with React + Node.js + MongoDB.

## Features
- **Authentication** — JWT login/register, first user auto-becomes admin
- **Issues** — create, edit, delete, filter by status/severity/search
- **Projects** — multi-project support with team members
- **Admin: Users** — add, edit, deactivate, delete team members
- **Admin: Projects** — create and manage projects
- **Dashboard** — stats, charts, issues assigned to you
- **Role-based access** — admin vs member permissions

---

## 🚀 Deploy on Render (Recommended — Free Tier)

### Step 1: MongoDB Atlas (free database)
1. Go to https://mongodb.com/atlas → create free account
2. Create a **Free M0 cluster**
3. Under Database Access → Add user (username + password)
4. Under Network Access → Allow `0.0.0.0/0`
5. Click Connect → Drivers → copy the connection string
   - Looks like: `mongodb+srv://user:password@cluster.mongodb.net/bugtracker`

### Step 2: Deploy Backend to Render
1. Push this repo to GitHub
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo, set **Root Directory** = `backend`
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment**: Node
5. Add Environment Variables:
   - `MONGODB_URI` = your Atlas connection string
   - `JWT_SECRET` = any long random string (e.g. `openssl rand -hex 32`)
   - `CLIENT_URL` = your frontend URL (add after deploying frontend)
   - `NODE_ENV` = `production`
6. Deploy — note the URL (e.g. `https://bugtracker-backend.onrender.com`)

### Step 3: Deploy Frontend to Render
1. Go to Render → New → Static Site
2. Connect same GitHub repo, set **Root Directory** = `frontend`
3. Settings:
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `build`
4. Add Environment Variable:
   - `REACT_APP_API_URL` = `https://bugtracker-backend.onrender.com/api`
5. Add Redirect/Rewrite Rule: `/* → /index.html` (200 rewrite)
6. Deploy — copy the frontend URL
7. Go back to backend service → update `CLIENT_URL` env var with frontend URL → redeploy backend

---

## 🚀 Deploy on Vercel

### Backend (Vercel Serverless)
```bash
cd backend
cp .env.example .env   # fill in values
npx vercel --prod
# Add env vars in Vercel dashboard
```

### Frontend (Vercel)
```bash
cd frontend
echo "REACT_APP_API_URL=https://your-backend.vercel.app/api" > .env.production
npx vercel --prod
```

---

## 💻 Local Development

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (or local MongoDB)

### Setup
```bash
# 1. Clone and install
git clone <your-repo>
cd bugtracker

# 2. Backend
cd backend
cp .env.example .env
# Edit .env with your MONGODB_URI and JWT_SECRET
npm install
npm run dev   # runs on http://localhost:5000

# 3. Frontend (new terminal)
cd frontend
echo "REACT_APP_API_URL=http://localhost:5000/api" > .env.local
npm install
npm start     # runs on http://localhost:3000
```

### First Login
1. Go to http://localhost:3000/register
2. Register — first user auto-becomes **admin**
3. Admin can add more users at Admin → Users

---

## Project Structure
```
bugtracker/
├── backend/
│   ├── models/         # Mongoose models (User, Project, Issue)
│   ├── routes/         # Express routes (auth, users, projects, issues)
│   ├── middleware/     # JWT auth + admin guard
│   ├── server.js       # Entry point
│   └── vercel.json     # Vercel config
├── frontend/
│   ├── src/
│   │   ├── context/    # AuthContext (JWT state)
│   │   ├── pages/      # Login, Register, Dashboard, Issues, Admin*
│   │   ├── components/ # Layout (sidebar + nav)
│   │   └── api.js      # Fetch wrapper with JWT
│   └── public/
└── render.yaml         # Render deployment config
```

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | Register (1st = admin) |
| POST | /api/auth/login | — | Login → JWT token |
| GET | /api/auth/me | ✓ | Current user |
| GET | /api/users | ✓ | List users |
| POST | /api/users | Admin | Add user |
| PUT | /api/users/:id | Admin | Edit user |
| DELETE | /api/users/:id | Admin | Delete user |
| GET | /api/projects | ✓ | List projects |
| POST | /api/projects | ✓ | Create project |
| GET | /api/issues | ✓ | List issues (filterable) |
| POST | /api/issues | ✓ | Create issue |
| PUT | /api/issues/:id | ✓ | Update issue |
| DELETE | /api/issues/:id | ✓ | Delete issue |
| POST | /api/issues/:id/comments | ✓ | Add comment |
