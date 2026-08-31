create table if not exists public.repositories (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  external_id text not null,
  added_at timestamptz not null default now(),
  unique(owner_id, external_id),
  unique(id, owner_id)
);

create table if not exists public.views (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  repository_id text not null,
  title text not null,
  description text not null default '',
  view_type text not null default 'custom' check (view_type in ('landscape', 'system', 'component', 'code', 'custom')),
  scope text not null default '',
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  parent_view_id text,
  parent_node_id text,
  revision integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, owner_id),
  foreign key (repository_id, owner_id) references public.repositories(id, owner_id) on delete cascade,
  foreign key (parent_view_id, owner_id) references public.views(id, owner_id) on delete cascade
);
create unique index if not exists views_active_parent_node on public.views(parent_view_id,parent_node_id) where parent_view_id is not null and archived_at is null;

create table if not exists public.traces (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  view_id text not null,
  title text not null,
  description text not null default '',
  steps jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (view_id, owner_id) references public.views(id, owner_id) on delete cascade
);

create table if not exists public.mcp_tokens (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  prefix text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.repositories enable row level security;
alter table public.views enable row level security;
alter table public.traces enable row level security;
alter table public.mcp_tokens enable row level security;

create policy "owners manage repositories" on public.repositories for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage views" on public.views for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage traces" on public.traces for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage mcp tokens" on public.mcp_tokens for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index if not exists repositories_owner on public.repositories(owner_id,added_at desc);
create index if not exists views_owner_repository on public.views(owner_id,repository_id,updated_at desc);
create index if not exists traces_owner_view on public.traces(owner_id,view_id,updated_at desc);
create index if not exists mcp_tokens_owner on public.mcp_tokens(owner_id,created_at desc);
