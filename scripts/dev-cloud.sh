#!/bin/sh
set -eu

project_ref="jnjajqlojjhgkjmnvhbs"
project_url="https://${project_ref}.supabase.co"
pooler_host="aws-0-ap-southeast-1.pooler.supabase.com"
publishable_key="sb_publishable_qm6VaaQeRyJInBaZ1uRZEQ_u7c_bKwG"

if ! db_password="$(security find-generic-password -a cartograph -s cartograph-supabase-db -w 2>/dev/null)" || [ -z "$db_password" ]; then
  echo "Cartograph's Supabase database password is missing from macOS Keychain." >&2
  echo "Restore the cartograph-supabase-db item before starting development." >&2
  exit 1
fi

export DATABASE_URL="postgresql://postgres.${project_ref}:${db_password}@${pooler_host}:5432/postgres"
export SUPABASE_URL="$project_url"
export CARTOGRAPH_WEB_ORIGIN="http://localhost:5173"
export CARTOGRAPH_MCP_URL="http://localhost:4310/mcp"
export VITE_SUPABASE_URL="$project_url"
export VITE_SUPABASE_PUBLISHABLE_KEY="$publishable_key"
export VITE_API_URL="http://localhost:4310"
export VITE_APP_URL="http://localhost:5173"
export VITE_MARKETING_URL="http://localhost:5173/public"
export VITE_CARTOGRAPH_SURFACE="app"

exec npx concurrently -n api,web -c cyan,magenta \
  "npm run dev -w @cartograph/server" \
  "npm run dev -w @cartograph/web"
