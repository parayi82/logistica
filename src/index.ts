import { supabase } from "@/lib/supabaseClient";

const { data } = await supabase.auth.getSession();
window.location.href = data.session ? "/dashboard.html" : "/login.html";
