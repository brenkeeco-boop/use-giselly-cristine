/* Painel administrativo — autenticação.
   Usa o cliente Supabase JÁ EXISTENTE (assets/js/supabase.js → window.supabaseClient).
   Não cria outro cliente e não usa nenhuma chave além da publishable que o site já carrega.

   Quem é admin?  user.app_metadata.role === "admin".
   • app_metadata só pode ser gravado no servidor (SQL Editor / service_role) — o próprio usuário
     NÃO consegue se promover pelo navegador (diferente de user_metadata, que ele edita).
   • Esta checagem no navegador é só a camada de UX. A proteção real dos dados é o RLS do banco.
     (Este site é estático: o código desta pasta é público e não contém segredo algum.) */
(function () {
  "use strict";

  var LOGIN_URL = "login.html";
  var HOME_URL = "index.html";
  var ADMIN_ROLE = "admin";
  var loggingOut = false;

  function client() { return window.supabaseClient; }

  function isAdmin(user) {
    return Boolean(user && user.app_metadata && user.app_metadata.role === ADMIN_ROLE);
  }

  function isNetworkError(error) {
    if (!error) return false;
    var text = ((error.name || "") + " " + (error.message || "")).toLowerCase();
    return error.name === "AuthRetryableFetchError" || /fetch|network|failed to|timeout/.test(text);
  }

  function friendlyError(error) {
    var code = (error && error.code) || "";
    var message = ((error && error.message) || "").toLowerCase();
    if (isNetworkError(error)) return "Não foi possível conectar. Verifique sua internet e tente novamente.";
    if (code === "invalid_credentials" || message.indexOf("invalid login credentials") !== -1) return "E-mail ou senha incorretos.";
    if (code === "email_not_confirmed" || message.indexOf("email not confirmed") !== -1) return "Confirme seu e-mail antes de entrar.";
    if (code === "over_request_rate_limit" || error.status === 429 || message.indexOf("rate limit") !== -1) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
    return "Não foi possível entrar agora. Tente novamente.";
  }

  /* Pergunta ao servidor (getUser valida o token e traz app_metadata atualizado). */
  async function inspectSession() {
    var c = client();
    if (!c || !c.auth) return { status: "error" };
    var result;
    try { result = await c.auth.getUser(); } catch (e) { return { status: "error" }; }
    if (result.error) return { status: isNetworkError(result.error) ? "error" : "anon" };
    var user = result.data && result.data.user;
    if (!user) return { status: "anon" };
    return { status: isAdmin(user) ? "admin" : "forbidden", user: user };
  }

  function showBootError() {
    var boot = document.getElementById("admBoot");
    if (!boot) return;
    var msg = boot.querySelector("[data-boot-msg]");
    var retry = boot.querySelector("[data-boot-retry]");
    boot.classList.add("is-error");
    if (msg) msg.textContent = "Não foi possível verificar o seu acesso agora. Verifique sua internet e tente de novo.";
    if (retry) { retry.hidden = false; retry.onclick = function () { location.reload(); }; }
  }

  /* Protege uma página: devolve o usuário admin, ou redireciona para o login e devolve null. */
  async function requireAdmin() {
    var r = await inspectSession();
    if (r.status === "admin") {
      client().auth.onAuthStateChange(function (event) {
        if (event === "SIGNED_OUT" && !loggingOut) location.replace(LOGIN_URL);
      });
      return r.user;
    }
    if (r.status === "error") { showBootError(); return null; }
    location.replace(r.status === "forbidden" ? LOGIN_URL + "?motivo=sem-acesso" : LOGIN_URL);
    return null;
  }

  /* Na tela de login: se já existe sessão de admin, vai direto ao Dashboard. */
  async function redirectIfAdmin() {
    var r = await inspectSession();
    if (r.status === "admin") location.replace(HOME_URL);
  }

  async function login(email, password) {
    var c = client();
    if (!c || !c.auth) return { ok: false, message: "Não foi possível conectar. Verifique sua internet e tente novamente." };
    var result;
    try { result = await c.auth.signInWithPassword({ email: email, password: password }); }
    catch (e) { return { ok: false, message: friendlyError(e) }; }
    if (result.error) return { ok: false, message: friendlyError(result.error) };
    if (!isAdmin(result.data && result.data.user)) {
      /* Login válido, mas de uma conta comum: encerra esta sessão aqui mesmo. */
      try { await c.auth.signOut({ scope: "local" }); } catch (e) { /* sessão local já é descartada */ }
      return { ok: false, message: "Esta conta não tem acesso ao painel administrativo." };
    }
    return { ok: true };
  }

  /* scope "local": encerra só ESTE navegador (o padrão "global" derrubaria a sessão em todos os aparelhos). */
  async function logout() {
    loggingOut = true;
    try { await client().auth.signOut({ scope: "local" }); } catch (e) { /* segue para o login */ }
    location.replace(LOGIN_URL + "?motivo=saiu");
  }

  window.AdminAuth = {
    requireAdmin: requireAdmin,
    redirectIfAdmin: redirectIfAdmin,
    login: login,
    logout: logout,
    isAdmin: isAdmin
  };
})();
