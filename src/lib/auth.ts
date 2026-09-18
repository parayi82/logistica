import { supabase } from "@/lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

export async function requireSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "/login.html";
    throw new Error("no session");
  }
  return data.session;
}

export async function currentProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, tenant_id, role, full_name")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data as { id: string; tenant_id: string; role: string; full_name: string };
}
