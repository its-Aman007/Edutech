# Orbit Workspace

A full-stack project collaboration workspace for managing projects, teams, and tasks. The interface is a responsive React/Vite dashboard; the API is an Express/Mongoose REST service with JWT authentication, role-based access, validation, pagination, comments, attachments, audit logs, and Swagger docs.

## Structure

- `frontend/` React + Vite dashboard UI
- `backend/` Express REST API and MongoDB models
- `docker-compose.yml` local multi-service setup

## Run locally

1. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_URL`.
2. Run `npm install` in both `backend` and `frontend`.
3. Start the API with `npm run dev` from `backend`.
4. Start the UI with `npm run dev` from `frontend`.
5. Visit `http://localhost:5173`; API docs are at `http://localhost:4000/api/docs`.

The provided MongoDB URI should be stored only in `backend/.env`, never committed. Registering with a requested `admin` role is intentionally downgraded to member; promote trusted accounts directly in MongoDB or add an admin provisioning flow.

## API highlights

- `POST /api/auth/register`, `POST /api/auth/login`
- `GET|POST /api/projects`, `PATCH|DELETE /api/projects/:id`
- `GET|POST /api/tasks`, `PATCH|DELETE /api/tasks/:id`
- `POST /api/tasks/:id/comments`, `POST /api/tasks/:id/attachments`
- `GET /api/dashboard`, `GET /api/audit-logs`

## Testing

Run `npm test` in `backend` for the health endpoint smoke test. Add integration tests against a disposable MongoDB instance for authenticated CRUD paths before production deployment.
