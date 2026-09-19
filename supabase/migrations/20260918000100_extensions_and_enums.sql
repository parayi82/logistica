-- Extensiones necesarias
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "postgis" with schema extensions;

-- Esquema privado para funciones auxiliares de autorización (RLS helpers)
create schema if not exists app;

-- Enums de dominio
create type public.app_role as enum (
  'ADMIN',
  'JEFATURA',
  'MONITOR',
  'SEGURIDAD_PATRIMONIAL',
  'CLIENTE_VIEW'
);

create type public.trip_status as enum (
  'PROGRAMADO',
  'EN_TRANSITO',
  'DETENIDO',
  'FINALIZADO',
  'CANCELADO'
);

create type public.trip_event_type as enum (
  'EN_TRANSITO',
  'DETENCION',
  'REINICIO',
  'EVIDENCIA',
  'UBICACION'
);

create type public.report_channel as enum (
  'whatsapp',
  'dashboard',
  'api'
);

create type public.geofence_validation_status as enum (
  'DENTRO',
  'FUERA',
  'SIN_VALIDAR'
);

create type public.compliance_status as enum (
  'CUMPLE',
  'NO_CUMPLE',
  'NA'
);

create type public.shift_report_status as enum (
  'PENDIENTE',
  'GENERADO',
  'ENVIADO',
  'ERROR'
);

create type public.evidence_type as enum (
  'FOTO',
  'UBICACION'
);
