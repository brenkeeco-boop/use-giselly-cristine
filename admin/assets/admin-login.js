/* Painel administrativo — tela de login.
   A senha só passa pelo campo do formulário até o Supabase Auth: nada é gravado nem logado. */
(function () {
  "use strict";

  var form = document.getElementById("adminLoginForm");
  var alertBox = document.getElementById("loginAlert");
  var emailInput = document.getElementById("adminEmail");
  var passwordInput = document.getElementById("adminPassword");
  var submit = document.getElementById("adminLoginSubmit");

  function show(text, type) {
    alertBox.textContent = text;
    alertBox.className = "adm-alert adm-alert--" + (type || "error");
    alertBox.hidden = false;
  }
  function hide() { alertBox.hidden = true; alertBox.textContent = ""; }

  var reason = new URLSearchParams(location.search).get("motivo");
  if (reason) history.replaceState(null, "", location.pathname);
  if (reason === "sem-acesso") show("Esta conta não tem acesso ao painel administrativo.", "error");
  else if (reason === "saiu") show("Você saiu do painel.", "info");
  else window.AdminAuth.redirectIfAdmin(); /* já logado como admin → Dashboard */

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    hide();
    var email = emailInput.value.trim();
    var password = passwordInput.value;
    if (!email || !password) return show("Informe e-mail e senha.", "error");

    submit.disabled = true;
    submit.textContent = "Entrando…";
    var result = await window.AdminAuth.login(email, password);
    if (result.ok) return location.replace("index.html");

    submit.disabled = false;
    submit.textContent = "Entrar";
    show(result.message, "error");
    passwordInput.value = "";
    passwordInput.focus();
  });
})();
