# Fest DBMS

Simple DBMS course project for managing student fest records.

## Deploy on Vercel

Connect this GitHub repository to Vercel and add these server-side environment variables to Development, Preview, and Production:

- SUPABASE_URL: Supabase Project URL.
- SUPABASE_SERVICE_ROLE_KEY: Supabase service-role/secret key. Keep private; never put it in browser code or Git.
- APP_PASSWORD: a long password required to use the demo app.

The project uses the Supabase PostgreSQL tables created by supabase_schema.sql and seeded with the supplied seed files. Vercel rebuilds the site when new commits are pushed after Git integration is connected.

## Local development

1. Install Node.js.
2. Run: npm install
3. Copy .env.example to .env and fill the variables locally.
4. Run: npx vercel dev

The app asks for APP_PASSWORD in the browser. It uses serverless API routes to query Supabase; credentials remain on the server.

## Features

- Search, insert, update, and delete from the project tables.
- Review SQL previews before running operations.
- Sort visible results by clicking a column heading; wide tables scroll horizontally.
- Updates and deletes require filters and confirmation.
- Reports for event categories and registrations.

## Project team

- Kuladeep K — CS25B1021
- Mohit R — CS25B1022
- Rithvik S — CS25B1049

