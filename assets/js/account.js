let currentUser = null;

function authMessage(error){
  const message = (error?.message || "").toLowerCase();
  if (message.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (message.includes("already registered") || message.includes("already been registered")) return "Este e-mail já está cadastrado.";
  if (message.includes("password should be")) return "A senha não atende aos requisitos de segurança.";
  if (message.includes("invalid email")) return "Informe um e-mail válido.";
  if (message.includes("network") || message.includes("fetch")) return "Não foi possível conectar. Verifique sua internet e tente novamente.";
  return "Não foi possível realizar esta ação. Tente novamente.";
}

function showNotice(text, type = "info"){
  const notice = document.getElementById("accountNotice");
  notice.textContent = text;
  notice.className = `account-notice ${type}`;
  notice.hidden = false;
}

function clearNotice(){
  const notice = document.getElementById("accountNotice");
  notice.hidden = true;
  notice.textContent = "";
}

function showTab(name){
  const target = document.getElementById(`tab-${name}`);
  if (!target || (!currentUser && target.dataset.authOnly === "true")) name = "entrar";
  document.querySelectorAll(".tab-panel").forEach(panel => panel.style.display = "none");
  document.querySelectorAll(".tab-btn").forEach(button => button.classList.toggle("active", button.dataset.tab === name));
  document.getElementById(`tab-${name}`).style.display = "block";
  if (name === "favoritos") renderFavorites();
}

function setAccountState(user){
  currentUser = user || null;
  document.querySelectorAll("[data-auth-only]").forEach(el => el.hidden = !currentUser);
  document.querySelectorAll("[data-guest-only]").forEach(el => el.hidden = Boolean(currentUser));
  const accountLink = document.querySelector('a[aria-label="Conta"]');
  if (accountLink) accountLink.setAttribute("aria-label", currentUser ? "Minha conta" : "Conta");
}

async function loadProfile(user){
  const { data: perfil, error } = await supabaseClient
    .from("perfis")
    .select("nome, telefone, cpf, data_nascimento")
    .eq("id", user.id)
    .maybeSingle();

  if (error){
    showNotice("Não foi possível carregar seus dados agora. Tente novamente.", "error");
    return;
  }

  document.getElementById("profileEmail").value = user.email || "";
  document.getElementById("profileName").value = perfil?.nome || user.user_metadata?.nome || "";
  document.getElementById("profilePhone").value = perfil?.telefone || user.user_metadata?.telefone || "";
  document.getElementById("profileCpf").value = perfil?.cpf || "";
  document.getElementById("profileBirthDate").value = perfil?.data_nascimento || "";
}

async function handleSession(session){
  setAccountState(session?.user);
  if (session?.user){
    await loadProfile(session.user);
    const requestedTab = new URLSearchParams(location.search).get("tab");
    showTab(requestedTab === "favoritos" ? "favoritos" : "perfil");
  } else {
    showTab(new URLSearchParams(location.search).get("tab") === "cadastrar" ? "cadastrar" : "entrar");
  }
}

function renderFavorites(){
  const favs = getFavorites();
  const grid = document.getElementById("favGrid");
  const empty = document.getElementById("favEmpty");
  if (favs.length === 0){ grid.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  grid.innerHTML = favs.map(id => getProductById(id)).filter(Boolean).map(productCardHTML).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  mountLayout();
  document.querySelectorAll(".tab-btn").forEach(button => button.addEventListener("click", () => showTab(button.dataset.tab)));
  document.querySelectorAll("[data-goto]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.goto)));

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearNotice();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!email || !password) return showNotice("Preencha e-mail e senha para entrar.", "error");
    const button = document.getElementById("loginSubmit");
    button.disabled = true;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    button.disabled = false;
    if (error) showNotice(authMessage(error), "error");
  });

  document.getElementById("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearNotice();
    const nome = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const confirmation = document.getElementById("signupPasswordConfirmation").value;
    if (!nome || !email || !password || !confirmation) return showNotice("Preencha todos os campos obrigatórios.", "error");
    if (password !== confirmation) return showNotice("As senhas não coincidem.", "error");
    const button = document.getElementById("signupSubmit");
    button.disabled = true;
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { nome } }
    });
    button.disabled = false;
    if (error) return showNotice(authMessage(error), "error");
    showNotice(data.session ? "Cadastro realizado com sucesso!" : "Cadastro realizado. Verifique seu e-mail para continuar.", "success");
  });

  document.getElementById("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return showTab("entrar");
    clearNotice();
    const button = document.getElementById("profileSubmit");
    button.disabled = true;
    const { error } = await supabaseClient
      .from("perfis")
      .update({
        nome: document.getElementById("profileName").value.trim(),
        telefone: document.getElementById("profilePhone").value.trim() || null,
        cpf: document.getElementById("profileCpf").value.trim() || null,
        data_nascimento: document.getElementById("profileBirthDate").value || null,
        atualizado_em: new Date().toISOString()
      })
      .eq("id", currentUser.id);
    button.disabled = false;
    if (error) return showNotice("Não foi possível atualizar seus dados. Tente novamente.", "error");
    showNotice("Dados atualizados com sucesso.", "success");
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    clearNotice();
    const { error } = await supabaseClient.auth.signOut();
    if (error) return showNotice("Não foi possível sair da conta. Tente novamente.", "error");
    showNotice("Você saiu da sua conta.", "success");
  });

  const { data: { session } } = await supabaseClient.auth.getSession();
  await handleSession(session);
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleSession(session), 0);
  });
});
