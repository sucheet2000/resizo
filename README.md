<div align="center">

![Next.js](https://img.shields.io/badge/Next.js%2016-black?style=flat-square&logo=next.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-passing-success?style=flat-square&logo=github)](https://github.com/sucheet2000/resizo/actions)

# Resizo

**A production-grade image processing platform. Resize, compress, convert, crop and convert HEIC images — all server-side with Sharp.**

[Live Demo](https://www.resizo.net)

</div>

---

##  Tools

* **[Image Resizer](https://www.resizo.net)** — Resize by dimensions or percentage, with aspect ratio lock.
* **[Bulk Resize](https://www.resizo.net)** — Process up to 20 images simultaneously with per-image configurations and ZIP download.
* **[Compress](https://www.resizo.net/compress)** — Quality slider for optimizing JPEG, PNG, and WebP images.
* **[Convert](https://www.resizo.net/convert)** — Seamlessly convert between JPEG, PNG, and WebP formats.
* **[Crop](https://www.resizo.net/crop)** — Pixel-precise cropping backed by server-side bounds validation.
* **[HEIC to JPEG](https://www.resizo.net/heic)** — Convert iPhone HEIC/HEIF photos for broader compatibility.

##  Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Next.js 16 App Router, React, Tailwind CSS |
| **Image Processing** | Sharp (server-side Node.js, never client-side) |
| **Authentication** | Supabase Auth — Google OAuth (PKCE) + email/password |
| **Database** | Supabase PostgreSQL with Row Level Security |
| **Rate Limiting** | Upstash Redis — sliding window per endpoint per IP |
| **Deployment** | Vercel (production), Docker multi-stage (self-hosted) |
| **CI/CD** | GitHub Actions — lint → build pipeline |

##  Architecture

```text
       [ Browser / Client ]
                │
                ▼ (Requests)
[ Next.js 16 API Routes (App Router) ] ◄════╗ (Rate Limiting via Upstash Redis)
                │                           ║
                ▼                           ║
      [ Sharp Processing ]                  ║
  (Memory-safe, Server-side)                ║
                │                           ║
                ▼                           ║
     [ Supabase PostgreSQL ] ◄══════════════╝ (Auth & User Verification)
  (History & Logs Storage + RLS)
```

##  Security

Security and data integrity are fundamental to Resizo's architecture:

* **File Validation:** Server-side magic bytes validation ensuring files are strictly JPEG, PNG, WebP, GIF, or HEIC/HEIF before processing.
* **Strict Limits:** Requests are capped at 20MB per file with maximum dimensions of 8000×8000 pixels.
* **Bounds Validation:** Server-side bounds validation on all resize, crop, and compress parameters to prevent memory exhaustion or out-of-bounds access.
* **Rate Limiting:** Every public API route utilizes Upstash Redis sliding window rate limiting based on `x-real-ip` (avoiding `x-forwarded-for` spoofing).
* **Brute Force Protection:** Authentication endpoints are strictly rate-limited.
* **Secure Headers:** Implementation of Content Security Policy (CSP), HSTS, X-Frame-Options, and X-Content-Type-Options.
* **Database Security:** Strict Row Level Security (RLS) enforcement on all Supabase PostgreSQL tables.
* **Authentication Security:** PKCE OAuth flow ensures authorization tokens are never exposed in browser history. Services utilize the Supabase Service Role Key solely on the server-side, never exposing it to the client.
* **Metadata Stripping:** EXIF and associated metadata are entirely stripped from all output images (`Sharp.withMetadata(false)`).

##  GDPR & Privacy

Resizo is designed with privacy-first principles:

* **Ephemeral Processing:** Images are processed in memory and never stored between requests or saved to disk.
* **Metadata Removal:** All location data and EXIF metadata are stripped from processed images.
* **Right to Erasure:** Complete account and history deletion is available directly via the user dashboard.
* **Data Portability:** Users can export their full resize history in CSV format.
* Read our comprehensive [Privacy Policy](https://www.resizo.net/privacy) and [Terms of Service](https://www.resizo.net/terms).

##  Local Development

To run Resizo locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/sucheet2000/resizo.git
   cd resizo
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure your local environment by creating a `.env.local` file.
   ```env
   # .env.local example
   NEXT_PUBLIC_SUPABASE_URL="YOUR_SUPABASE_URL"
   NEXT_PUBLIC_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
   
   # Server-side ONLY
   SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
   UPSTASH_REDIS_REST_URL="YOUR_UPSTASH_URL"
   UPSTASH_REDIS_REST_TOKEN="YOUR_UPSTASH_TOKEN"
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

##  Docker (Self-Hosted)

Resizo supports multi-stage Docker builds. To run the application via Docker Compose:

```bash
export NEXT_PUBLIC_SUPABASE_URL="YOUR_SUPABASE_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
export UPSTASH_REDIS_REST_URL="YOUR_UPSTASH_URL"
export UPSTASH_REDIS_REST_TOKEN="YOUR_UPSTASH_TOKEN"

docker-compose up --build
```

##  Database Schema

Resizo relies on a secure PostgreSQL setup via Supabase.

```sql
-- Resize History Table
CREATE TABLE resize_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    original_format TEXT NOT NULL,
    output_format TEXT NOT NULL,
    original_size_bytes BIGINT NOT NULL,
    output_size_bytes BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for History
ALTER TABLE resize_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own resize history"
    ON resize_history FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own resize history"
    ON resize_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Reviews Table
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for Reviews
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviews are viewable by everyone"
    ON reviews FOR SELECT
    USING (true);

CREATE POLICY "Users can insert own reviews"
    ON reviews FOR INSERT
    WITH CHECK (auth.uid() = user_id);
```

##  CI/CD

Resizo maintains a robust Continuous Integration and Deployment pipeline utilizing GitHub Actions.

Our pipeline strictly enforces logic and consistency across two sequentially prioritized jobs:
1. **Lint Job (~22s):** Validates code styling, dependencies, and formatting checks via ESLint before progressing.
2. **Build Job (~33s):** Verifies the production build viability of the Next.js application, pulling environment configurations securely from GitHub Secrets.

---

<div align="center">
Built by Sucheet Boppana · Live at <a href="https://www.resizo.net">resizo.net</a>
</div>
