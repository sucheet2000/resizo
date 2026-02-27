# Resizo

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?style=flat-square&logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-green?style=flat-square&logo=supabase)
![Docker](https://img.shields.io/badge/Docker-Containerized-blue?style=flat-square&logo=docker)
![Vercel](https://img.shields.io/badge/Vercel-Deployed-black?style=flat-square&logo=vercel)

A full-stack image resizing web application with server-side Sharp processing, Google OAuth authentication, PostgreSQL resize history, and a personal dashboard.

**Live:** https://www.resizo.net

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React, Tailwind CSS |
| Image Processing | Sharp (server-side, Node.js) |
| Authentication | Supabase Auth (Google OAuth + Email) |
| Database | Supabase PostgreSQL with Row Level Security |
| Deployment | Vercel (production), Docker (containerized) |
| CI/CD | GitHub Actions |

---

## Architecture
```
Browser → Next.js App Router → /api/resize (Sharp) → Download
                ↓
         Supabase Auth (PKCE OAuth flow)
                ↓
         PostgreSQL (resize_history table, RLS enforced)
                ↓
         /dashboard (per-user stats + activity table)
```

---

## Features

- Server-side image processing with Sharp — JPEG, PNG, WebP output
- Resize by exact dimensions or percentage scale
- Aspect ratio lock
- Magic bytes file validation — rejects spoofed file extensions
- 20MB file size limit with 8000x8000px dimension cap
- Google OAuth and email/password authentication
- Per-user resize history saved to PostgreSQL
- Dashboard with total images resized, data saved, most used format
- Row Level Security — users can only access their own data
- Mobile responsive
- Dockerized with multi-stage build for minimal image size

---

## Local Development
```bash
# Clone
git clone https://github.com/sucheet2000/resizo.git
cd resizo

# Install
npm install

# Environment variables
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

# Run
npm run dev
```

Visit `http://localhost:3000`

---

## Docker
```bash
export NEXT_PUBLIC_SUPABASE_URL=your_url
export NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
docker-compose up --build
```

Visit `http://localhost:3000`

---

## Database Schema
```sql
create table public.resize_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  original_filename text not null,
  original_width integer not null,
  original_height integer not null,
  resized_width integer not null,
  resized_height integer not null,
  output_format text not null,
  original_size_bytes bigint not null,
  resized_size_bytes bigint not null,
  created_at timestamptz default now() not null
);

alter table public.resize_history enable row level security;
```

---

## CI/CD

GitHub Actions runs on every push to `main`:
- Installs dependencies
- Runs `npm run build` with production env vars from GitHub Secrets
- Vercel auto-deploys on successful push

---

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous public key |

---

## Security

- Magic bytes validation on all uploads
- File size and dimension caps enforced server-side
- Row Level Security on all database tables
- PKCE OAuth flow via Supabase SSR
- Non-root user inside Docker container
- No raw SQL — all queries through Supabase client

---

Built by Sucheet Boppana
