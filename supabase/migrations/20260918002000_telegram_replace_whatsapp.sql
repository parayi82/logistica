-- =========================================================================
-- Reemplaza la integración de WhatsApp Business Platform por Telegram Bot
-- API: cero verificación de negocio, setup en minutos vía @BotFather. La
-- lógica de negocio (record_trip_event, geocercas, atrasos, evidencia) no
-- cambia en absoluto — solo el canal de entrada/salida de mensajes.
-- =========================================================================

alter type public.report_channel add value if not exists 'telegram';

-- ---------------------------------------------------------------------
-- Fuera con las tablas específicas de WhatsApp (nunca se usaron con datos
-- reales: la integración jamás se conectó a un proyecto de Meta).
-- ---------------------------------------------------------------------
drop policy if exists whatsapp_inbound_messages_select on public.whatsapp_inbound_messages;
drop table if exists public.whatsapp_inbound_messages;

drop policy if exists whatsapp_conversation_state_select on public.whatsapp_conversation_state;
drop policy if exists whatsapp_conversation_state_write_admin on public.whatsapp_conversation_state;
drop table if exists public.whatsapp_conversation_state;

drop policy if exists whatsapp_contacts_select on public.whatsapp_contacts;
drop policy if exists whatsapp_contacts_write_admin on public.whatsapp_contacts;
drop table if exists public.whatsapp_contacts;

-- ---------------------------------------------------------------------
-- Equivalentes para Telegram. Un contacto se resuelve la primera vez que
-- el operador comparte su número (botón nativo "Compartir mi teléfono",
-- Telegram confirma que es el suyo) y se empareja contra operators.phone_e164.
-- ---------------------------------------------------------------------
-- tenant_id es NULLABLE a propósito: el primer mensaje de un usuario de
-- Telegram solo trae su telegram_user_id (a diferencia de WhatsApp, cuyo
-- primer mensaje ya trae el número de teléfono) — no sabemos a qué tenant
-- pertenece hasta que comparte su teléfono y lo emparejamos contra
-- operators.phone_e164. telegram_user_id es único de por sí (un solo bot
-- compartido entre tenants), por eso la unicidad no incluye tenant_id.
create table public.telegram_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  telegram_user_id bigint not null,
  phone_e164 text,
  operator_id uuid references public.operators (id) on delete set null,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  unique (telegram_user_id)
);

create index telegram_contacts_tenant_id_idx on public.telegram_contacts (tenant_id);
create index telegram_contacts_operator_id_idx on public.telegram_contacts (operator_id);

create table public.telegram_conversation_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null references public.telegram_contacts (id) on delete cascade,
  current_step text not null default 'MENU_PRINCIPAL',
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (contact_id)
);

create index telegram_conversation_state_tenant_id_idx on public.telegram_conversation_state (tenant_id);

-- Dedupe por update_id (Telegram lo garantiza único y creciente por bot).
create table public.telegram_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  contact_id uuid references public.telegram_contacts (id) on delete set null,
  update_id bigint not null unique,
  message_type text not null,
  processed boolean not null default false,
  error text,
  raw_payload jsonb not null,
  received_at timestamptz not null default now()
);

create index telegram_inbound_messages_tenant_id_idx on public.telegram_inbound_messages (tenant_id);

alter table public.telegram_contacts enable row level security;
alter table public.telegram_conversation_state enable row level security;
alter table public.telegram_inbound_messages enable row level security;

create policy telegram_contacts_select on public.telegram_contacts
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() in ('ADMIN', 'JEFATURA'));

create policy telegram_contacts_write_admin on public.telegram_contacts
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy telegram_conversation_state_select on public.telegram_conversation_state
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() in ('ADMIN', 'JEFATURA'));

create policy telegram_conversation_state_write_admin on public.telegram_conversation_state
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create policy telegram_inbound_messages_select on public.telegram_inbound_messages
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.current_role() in ('ADMIN', 'JEFATURA'));

-- Sin policies de insert/update/delete para "authenticated": solo el
-- Edge Function (service_role) escribe estas 3 tablas.

-- ---------------------------------------------------------------------
-- Destinatarios del reporte de turno automático (Fase 6): antes se usaba
-- profiles.phone: WhatsApp Business Platform podía enviarle a cualquier
-- número. Telegram jamás puede iniciar una conversación — el destinatario
-- debe escribirle primero al bot (/start) para obtener su chat_id, que un
-- ADMIN pega aquí una sola vez.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column telegram_chat_id bigint;

comment on column public.profiles.telegram_chat_id is
  'Chat id de Telegram del usuario (lo obtiene enviando /start al bot); requerido para recibir el reporte de turno automático por Telegram.';
