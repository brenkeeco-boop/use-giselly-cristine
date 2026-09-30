/* Cliente único do Supabase para o front-end estático. A chave abaixo é publishable. */
const SUPABASE_URL = "https://wzesoeputihwzikhtfmt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LyjkUvdGY3aoKoVXzyp6IQ_c8twSF-n";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

/* Expõe a mesma instância para scripts que verificam a disponibilidade no window. */
window.supabaseClient = supabaseClient;
console.log("[DEBUG] SUPABASE CLIENTE GLOBAL DISPONÍVEL", { supabaseClientDisponivel: Boolean(window.supabaseClient) });
