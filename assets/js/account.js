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
  if (name === "enderecos") loadAddresses();
  if (name === "pedidos") loadOrders();
  if (name === "preferencias") loadPreferences();
}

function setAccountState(user){
  currentUser = user || null;
  document.querySelectorAll("[data-auth-only]").forEach(el => el.hidden = !currentUser);
  document.querySelectorAll("[data-guest-only]").forEach(el => el.hidden = Boolean(currentUser));
  const accountLink = document.querySelector('a[aria-label="Conta"]');
  if (accountLink) accountLink.setAttribute("aria-label", currentUser ? "Minha conta" : "Conta");
  if (!currentUser){
    ["profileName","profileEmail","profilePhone","profileCpf","profileBirthDate"].forEach(id => { const field = document.getElementById(id); if (field) field.value = ""; });
    const addresses = document.getElementById("addressList"); if (addresses) addresses.innerHTML = "";
    const favorites = document.getElementById("favGrid"); if (favorites) favorites.innerHTML = "";
    const orders = document.getElementById("ordersBody"); if (orders) orders.innerHTML = "";
    if (window.clearCustomerCache) clearCustomerCache();
  }
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
    try { await syncCloudCartToLocal(); await syncCloudFavoritesToLocal(); } catch {}
    await loadProfile(session.user);
    const requestedTab = new URLSearchParams(location.search).get("tab");
    showTab(requestedTab === "favoritos" ? "favoritos" : "perfil");
  } else {
    showTab(new URLSearchParams(location.search).get("tab") === "cadastrar" ? "cadastrar" : "entrar");
  }
}

function resetAddressForm(){
  document.getElementById("addressForm").reset();
  document.getElementById("addressId").value = "";
  document.getElementById("addressFormTitle").textContent = "Novo endereço";
}

function addressCard(address){
  return `<article class="address-card">
    <div><div class="address-card-head"><strong>${address.identificacao || "Endereço"}</strong>${address.principal ? '<span class="status-pill">Principal</span>' : ""}</div>
    <p>${address.nome_destinatario}<br>${address.rua}, ${address.numero}${address.complemento ? ` · ${address.complemento}` : ""}<br>${address.bairro} · ${address.cidade}/${address.estado}<br>CEP ${address.cep}</p></div>
    <div class="address-actions"><button type="button" class="auth-link" data-address-edit="${address.id}">Editar</button>${address.principal ? "" : `<button type="button" class="auth-link" data-address-main="${address.id}">Tornar principal</button>`}<button type="button" class="auth-link danger-link" data-address-delete="${address.id}">Excluir</button></div>
  </article>`;
}

async function loadAddresses(){
  if (!currentUser) return;
  const { data, error } = await supabaseClient.from("enderecos").select("*").eq("usuario_id", currentUser.id).order("principal", { ascending:false }).order("criado_em", { ascending:false });
  if (error) return showNotice("Não foi possível carregar seus endereços.", "error");
  const list = document.getElementById("addressList");
  list.innerHTML = data.length ? data.map(addressCard).join("") : '<p class="account-empty">Você ainda não cadastrou um endereço.</p>';
  list.dataset.addresses = JSON.stringify(data);
}

async function loadOrders(){
  if (!currentUser) return;
  const { data, error } = await supabaseClient.from("pedidos").select("id,numero_pedido,status,total,criado_em").eq("usuario_id", currentUser.id).order("criado_em", { ascending:false });
  if (error) return showNotice("Não foi possível carregar seus pedidos.", "error");
  document.getElementById("ordersBody").innerHTML = data.map(order => `<tr><td>${order.numero_pedido || `#${order.id.slice(0,8)}`}</td><td>${new Date(order.criado_em).toLocaleDateString("pt-BR")}</td><td><span class="status-pill">${order.status.replaceAll("_", " ")}</span></td><td>${formatBRL(Number(order.total))}</td></tr>`).join("");
  document.getElementById("ordersEmpty").style.display = data.length ? "none" : "block";
}

async function loadPreferences(){
  if (!currentUser) return;
  const { data, error } = await supabaseClient.from("preferencias_cliente").select("receber_ofertas,receber_novidades,receber_notificacoes_pedido").eq("usuario_id", currentUser.id).maybeSingle();
  if (error) return showNotice("Não foi possível carregar suas preferências.", "error");
  document.getElementById("offersPreference").checked = data?.receber_ofertas ?? true;
  document.getElementById("newsPreference").checked = data?.receber_novidades ?? true;
  document.getElementById("ordersPreference").checked = data?.receber_notificacoes_pedido ?? true;
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
    else {
      const returnTo = new URLSearchParams(location.search).get("returnTo");
      if (returnTo) location.assign(returnTo);
    }
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
    clearCustomerCache();
    showNotice("Você saiu da sua conta.", "success");
  });

  document.getElementById("addressForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return showTab("entrar");
    const id = document.getElementById("addressId").value;
    const payload = {
      usuario_id:currentUser.id, identificacao:document.getElementById("addressLabel").value.trim() || null,
      nome_destinatario:document.getElementById("addressRecipient").value.trim(), cep:document.getElementById("addressCep").value.trim(), rua:document.getElementById("addressStreet").value.trim(), numero:document.getElementById("addressNumber").value.trim(), complemento:document.getElementById("addressComplement").value.trim() || null, bairro:document.getElementById("addressDistrict").value.trim(), cidade:document.getElementById("addressCity").value.trim(), estado:document.getElementById("addressState").value.trim(), referencia:document.getElementById("addressReference").value.trim() || null, atualizado_em:new Date().toISOString()
    };
    const query = id ? supabaseClient.from("enderecos").update(payload).eq("id", id).eq("usuario_id", currentUser.id) : supabaseClient.from("enderecos").insert(payload);
    const { error } = await query;
    if (error) return showNotice("Não foi possível salvar o endereço.", "error");
    resetAddressForm(); await loadAddresses(); showNotice("Endereço salvo com sucesso.", "success");
  });
  document.getElementById("addressCancel").addEventListener("click", resetAddressForm);
  document.getElementById("addressList").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-address-edit]"); const main = event.target.closest("[data-address-main]"); const remove = event.target.closest("[data-address-delete]");
    const addresses = JSON.parse(document.getElementById("addressList").dataset.addresses || "[]");
    if (edit){ const address = addresses.find(item => item.id === edit.dataset.addressEdit); if (!address) return; document.getElementById("addressId").value = address.id; document.getElementById("addressFormTitle").textContent = "Editar endereço"; document.getElementById("addressLabel").value = address.identificacao || ""; document.getElementById("addressRecipient").value = address.nome_destinatario; document.getElementById("addressCep").value = address.cep; document.getElementById("addressStreet").value = address.rua; document.getElementById("addressNumber").value = address.numero; document.getElementById("addressComplement").value = address.complemento || ""; document.getElementById("addressDistrict").value = address.bairro; document.getElementById("addressCity").value = address.cidade; document.getElementById("addressState").value = address.estado; document.getElementById("addressReference").value = address.referencia || ""; document.getElementById("addressForm").scrollIntoView({ behavior:"smooth", block:"start" }); }
    if (main){ const { error:firstError } = await supabaseClient.from("enderecos").update({ principal:false, atualizado_em:new Date().toISOString() }).eq("usuario_id", currentUser.id); if (firstError) return showNotice("Não foi possível definir o endereço principal.", "error"); const { error } = await supabaseClient.from("enderecos").update({ principal:true, atualizado_em:new Date().toISOString() }).eq("id", main.dataset.addressMain).eq("usuario_id", currentUser.id); if (error) return showNotice("Não foi possível definir o endereço principal.", "error"); await loadAddresses(); showNotice("Endereço principal atualizado.", "success"); }
    if (remove){ const { error } = await supabaseClient.from("enderecos").delete().eq("id", remove.dataset.addressDelete).eq("usuario_id", currentUser.id); if (error) return showNotice("Não foi possível excluir o endereço.", "error"); await loadAddresses(); showNotice("Endereço excluído.", "success"); }
  });
  document.getElementById("preferencesForm").addEventListener("submit", async (event) => {
    event.preventDefault(); if (!currentUser) return;
    const { error } = await supabaseClient.from("preferencias_cliente").upsert({ usuario_id:currentUser.id, receber_ofertas:document.getElementById("offersPreference").checked, receber_novidades:document.getElementById("newsPreference").checked, receber_notificacoes_pedido:document.getElementById("ordersPreference").checked, atualizado_em:new Date().toISOString() });
    if (error) return showNotice("Não foi possível salvar suas preferências.", "error");
    showNotice("Preferências atualizadas com sucesso.", "success");
  });

  const { data: { session } } = await supabaseClient.auth.getSession();
  await handleSession(session);
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleSession(session), 0);
  });
});
