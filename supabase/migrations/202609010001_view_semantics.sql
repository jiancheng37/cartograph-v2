alter table public.views add column if not exists view_type text not null default 'custom';
alter table public.views add column if not exists scope text not null default '';
alter table public.views drop constraint if exists views_view_type_check;
alter table public.views add constraint views_view_type_check check (view_type in ('landscape', 'system', 'component', 'code', 'custom'));
