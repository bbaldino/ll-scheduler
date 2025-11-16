# Setup Guide

This guide will help you set up the Little League Scheduler application for local development.

## Prerequisites

- Node.js 20+ and pnpm installed
- Cloudflare account (for deployment)

## Initial Setup

### 1. Install Dependencies

```bash
pnpm install
```

This will install all dependencies for all packages in the monorepo.

### 2. Create Cloudflare D1 Database

You need to create a D1 database for both local development and production:

```bash
# Create a local D1 database for development
cd packages/backend
pnpm wrangler d1 create ll-scheduler-db-local

# Create a production D1 database
pnpm wrangler d1 create ll-scheduler-db
```

After creating the databases, copy the database IDs from the output and update `packages/backend/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ll-scheduler-db"
database_id = "YOUR_PRODUCTION_DATABASE_ID"

[env.development]
[[env.development.d1_databases]]
binding = "DB"
database_name = "ll-scheduler-db-local"
database_id = "YOUR_LOCAL_DATABASE_ID"
```

### 3. Run Database Migrations

Apply the database schema to your local database:

```bash
cd packages/backend
pnpm wrangler d1 migrations apply ll-scheduler-db-local --local
```

For production (when ready):

```bash
pnpm wrangler d1 migrations apply ll-scheduler-db
```

### 4. Start Development Servers

From the root directory, start all development servers:

```bash
pnpm dev
```

This will start:
- Frontend dev server at http://localhost:5173
- Backend API (Cloudflare Workers) at http://localhost:8787

## Project Structure

```
ll-scheduler/
├── packages/
│   ├── frontend/       # React web application (Vite)
│   ├── backend/        # Cloudflare Workers API (Hono)
│   ├── shared/         # Shared TypeScript types
│   └── db/             # Database schemas and migrations
├── package.json        # Root package.json with workspace config
└── pnpm-workspace.yaml # pnpm workspace configuration
```

## Available Scripts

From the root directory:

- `pnpm dev` - Start all development servers
- `pnpm build` - Build all packages
- `pnpm type-check` - Run TypeScript type checking
- `pnpm format` - Format code with Prettier

## Development Workflow

1. **Creating/Managing Seasons**: Visit http://localhost:5173/seasons to create and manage seasons
2. **Managing Fields**: Visit http://localhost:5173/fields to manage fields (requires a season to be selected)
3. **API Endpoints**: Backend API is available at http://localhost:8787/api

## Deployment

### Backend (Cloudflare Workers)

```bash
cd packages/backend
pnpm deploy
```

### Frontend (Cloudflare Pages)

1. Build the frontend:
```bash
cd packages/frontend
pnpm build
```

2. Deploy to Cloudflare Pages:
   - Connect your GitHub repository to Cloudflare Pages
   - Set build command: `cd packages/frontend && pnpm build`
   - Set build output directory: `packages/frontend/dist`
   - Deploy!

Alternatively, use Wrangler:
```bash
pnpm wrangler pages deploy packages/frontend/dist --project-name=ll-scheduler
```

### Update CORS Configuration

After deploying the frontend, update the CORS configuration in `packages/backend/src/index.ts` to include your production frontend URL.

## Troubleshooting

### Database Connection Issues

If you're having issues connecting to the D1 database:
1. Ensure you've run the migrations: `pnpm wrangler d1 migrations apply ll-scheduler-db-local --local`
2. Check that the database ID in `wrangler.toml` matches the one from `wrangler d1 create`

### Frontend Can't Connect to Backend

1. Ensure both servers are running (`pnpm dev` from root)
2. Check the proxy configuration in `packages/frontend/vite.config.ts`

## Next Steps

- Add Division and Team management
- Implement practice/game scheduling logic
- Add authentication
- Implement "copy from previous season" functionality
