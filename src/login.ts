import { supabase } from "@/lib/supabaseClient";

const form = document.getElementById("login-form") as HTMLFormElement;
const errorEl = document.getElementById("error") as HTMLDivElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;

async function redirectIfLoggedIn() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.href = "/dashboard.html";
  }
}

redirectIfLoggedIn();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";
  submitBtn.disabled = true;

  const email = (document.getElementById("email") as HTMLInputElement).value.trim();
  const password = (document.getElementById("password") as HTMLInputElement).value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.textContent = "Credenciales inválidas o cuenta inactiva.";
    submitBtn.disabled = false;
    return;
  }

  window.location.href = "/dashboard.html";
});
