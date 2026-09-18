import { supabase } from "@/lib/supabaseClient";

async function redirect() {
  const { data } = await supabase.auth.getSession();
  window.location.href = data.session ? "/dashboard.html" : "/login.html";
}

redirect();
