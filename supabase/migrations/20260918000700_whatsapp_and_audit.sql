-- Contactos de WhatsApp vistos por el webhook (Fase 3). Permite mapear un
-- número de teléfono entrante a un operador conocido del tenant.
create table public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  phone_e164 text not null,
  operator_id uuid references public.operators (id) on delete set null,
  role_context text,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, phone_e164)
);

create index whatsapp_contacts_tenant_id_idx on public.whatsapp_contacts (tenant_id);
create index whatsapp_contacts_operator_id_idx on public.whatsapp_contacts (operator_id);

-- Estado de la conversación guiada por botones/listas (máquina de estados
-- simple: en_transito / detencion / reinicio / evidencia / ubicacion)
create table public.whatsapp_conversation_state (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null references public.whatsapp_contacts (id) on delete cascade,
  current_step text not null default 'MENU_PRINCIPAL',
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (contact_id)
);

create index whatsapp_conversation_state_tenant_id_idx on public.whatsapp_conversation_state (tenant_id);

-- Auditoría general de acciones sensibles (cambios manuales de estatus,
-- justificación de atrasos, edición de geocercas, etc.)
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_tenant_id_idx on public.audit_log (tenant_id, created_at desc);
