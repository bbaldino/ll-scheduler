# Little League Scheduler

A web application for managing little league practice and game scheduling.

## Architecture

- **Frontend**: React + Vite + TypeScript (deployed to Cloudflare Pages)
- **Backend**: Cloudflare Workers + Hono
- **Database**: Cloudflare D1 (SQLite)

## Project Structure

```
packages/
  ├── frontend/    - React web application
  ├── backend/     - Cloudflare Workers API
  ├── shared/      - Shared TypeScript types
  └── db/          - Database schemas and migrations
```

## Development

```bash
# Install dependencies
pnpm install

# Run all services in development mode
pnpm dev

# Build all packages
pnpm build

# Format code
pnpm format
```

## Key Concepts

- **Season-scoped data**: All entities (Fields, Divisions, Teams, etc.) exist within the context of a Season
- **Separate Practice and Game models**: Practices and games have distinct scheduling rules and constraints
