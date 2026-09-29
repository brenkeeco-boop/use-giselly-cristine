/* Supabase é a fonte do carrinho e dos favoritos autenticados. localStorage é apenas cache da sessão atual. */
const CART_KEY = "ugc_cart";
const FAV_KEY = "ugc_favorites";
let activeUserId = null;

function readStore(key){ try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }
function writeStore(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
function clearCustomerCache(){ localStorage.removeItem(CART_KEY); localStorage.removeItem(FAV_KEY); activeUserId = null; updateCartCount(); updateFavCount(); document.dispatchEvent(new CustomEvent("ugc:cart-updated")); }
function getCart(){ return readStore(CART_KEY); }
function getFavorites(){ return readStore(FAV_KEY); }
function showAuthRequired(message){ if (window.showStoreNotice) showStoreNotice(message, "info"); else alert(message); }

function reportSupabaseError(table, operation, error){
  console.error("[Use Giselly Cristine][Supabase]", { table, operation, message:error?.message, code:error?.code, details:error?.details, hint:error?.hint, error });
}
function supabaseUserMessage(error){
  if (error?.code === "42501" || /row-level security|permission denied/i.test(error?.message || "")) return "Não foi possível concluir esta ação por permissão da sua conta.";
  if (/fetch|network|networkerror|failed to fetch/i.test(error?.message || "")) return "Não foi possível conectar ao serviço. Verifique sua internet e tente novamente.";
  return "Não foi possível concluir esta ação agora. Tente novamente.";
}

async function authenticatedUser(){
  if (!window.supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error){ reportSupabaseError("auth.users", "getUser", error); return null; }
    return data.user;
  } catch (error) { reportSupabaseError("auth.users", "getUser", error); return null; }
}

async function getCloudCart(userId){
  let { data, error } = await supabaseClient.from("carrinhos").select("id").eq("usuario_id", userId).maybeSingle();
  if (error) { reportSupabaseError("carrinhos", "select", error); throw error; }
  if (data) return data;
  ({ data, error } = await supabaseClient.from("carrinhos").insert({ usuario_id:userId }).select("id").single());
  if (error) { reportSupabaseError("carrinhos", "insert", error); throw error; }
  return data;
}

function localCartFromRemote(items){
  return items.map(item => ({ productId:item.produto_id, size:item.tamanho, color:item.cor, qty:item.quantidade }));
}

async function loadCloudCart(){
  const user = await authenticatedUser();
  if (!user) { clearCustomerCache(); return []; }
  try {
    const cart = await getCloudCart(user.id);
    const { data, error } = await supabaseClient.from("carrinho_itens").select("produto_id,tamanho,cor,quantidade").eq("carrinho_id", cart.id).order("criado_em");
    if (error) { reportSupabaseError("carrinho_itens", "select", error); throw error; }
    activeUserId = user.id; writeStore(CART_KEY, localCartFromRemote(data)); updateCartCount(); document.dispatchEvent(new CustomEvent("ugc:cart-updated"));
    return getCart();
  } catch (error) { reportSupabaseError("carrinho_itens", "loadCloudCart", error); throw error; }
}

async function addToCart(productId, size, color, qty = 1){
  const user = await authenticatedUser();
  if (!user){ showAuthRequired("Faça login para adicionar produtos à sacola."); return false; }
  try {
    const cart = await getCloudCart(user.id);
    const product = getProductById(productId);
    if (!product) { console.error("[Use Giselly Cristine] Produto não encontrado para o carrinho.", { productId }); showStoreNotice("Não foi possível localizar este produto.", "error"); return false; }
    const { data: existing, error: lookupError } = await supabaseClient.from("carrinho_itens").select("id,quantidade").eq("carrinho_id", cart.id).eq("produto_id", productId).eq("tamanho", size).eq("cor", color).maybeSingle();
    if (lookupError) { reportSupabaseError("carrinho_itens", "select item", lookupError); showStoreNotice(supabaseUserMessage(lookupError), "error"); return false; }
    const result = existing
      ? await supabaseClient.from("carrinho_itens").update({ quantidade:existing.quantidade + qty, atualizado_em:new Date().toISOString() }).eq("id", existing.id).eq("carrinho_id", cart.id)
      : await supabaseClient.from("carrinho_itens").insert({ carrinho_id:cart.id, produto_id:productId, nome_produto:product.name, imagem_produto:product.images[0], tamanho:size, cor, quantidade:qty, preco_unitario:product.price });
    if (result.error) { reportSupabaseError("carrinho_itens", existing ? "update quantidade" : "insert", result.error); showStoreNotice(supabaseUserMessage(result.error), "error"); return false; }
    await loadCloudCart(); return true;
  } catch (error) { reportSupabaseError("carrinhos/carrinho_itens", "addToCart", error); showStoreNotice(supabaseUserMessage(error), "error"); return false; }
}

async function updateCartQty(index, qty){
  const user = await authenticatedUser(); const item = getCart()[index];
  if (!user || !item) return false;
  const cart = await getCloudCart(user.id);
  const { data, error } = await supabaseClient.from("carrinho_itens").select("id").eq("carrinho_id", cart.id).eq("produto_id", item.productId).eq("tamanho", item.size).eq("cor", item.color).maybeSingle();
  if (error || !data) return false;
  const result = await supabaseClient.from("carrinho_itens").update({ quantidade:Math.max(1, qty), atualizado_em:new Date().toISOString() }).eq("id", data.id).eq("carrinho_id", cart.id);
  if (result.error) return false; await loadCloudCart(); return true;
}

async function removeFromCart(index){
  const user = await authenticatedUser(); const item = getCart()[index];
  if (!user || !item) return false;
  const cart = await getCloudCart(user.id);
  const { error } = await supabaseClient.from("carrinho_itens").delete().eq("carrinho_id", cart.id).eq("produto_id", item.productId).eq("tamanho", item.size).eq("cor", item.color);
  if (error) return false; await loadCloudCart(); return true;
}

function cartCount(){ return getCart().reduce((sum,item) => sum + item.qty, 0); }
function cartSubtotal(){ return getCart().reduce((sum,item) => { const product = getProductById(item.productId); return product ? sum + product.price * item.qty : sum; }, 0); }
function updateCartCount(){ document.querySelectorAll(".js-cart-count").forEach(el => { const count = cartCount(); el.textContent = count; el.style.display = count ? "flex" : "none"; }); }

async function loadCloudFavorites(){
  const user = await authenticatedUser();
  if (!user) { clearCustomerCache(); return []; }
  const { data, error } = await supabaseClient.from("favoritos").select("produto_id").eq("usuario_id", user.id);
  if (error) { reportSupabaseError("favoritos", "select", error); throw error; }
  activeUserId = user.id; writeStore(FAV_KEY, data.map(item => item.produto_id)); updateFavCount(); document.dispatchEvent(new CustomEvent("ugc:favorites-updated")); return getFavorites();
}

async function toggleFavorite(productId){
  const user = await authenticatedUser();
  if (!user){ showAuthRequired("Faça login para adicionar produtos aos favoritos."); return null; }
  try {
    const product = getProductById(productId); const exists = getFavorites().includes(productId);
    const result = exists
      ? await supabaseClient.from("favoritos").delete().eq("usuario_id", user.id).eq("produto_id", productId)
      : await supabaseClient.from("favoritos").insert({ usuario_id:user.id, produto_id:productId, nome_produto:product?.name || null, imagem_produto:product?.images?.[0] || null });
    if (result.error){ reportSupabaseError("favoritos", exists ? "delete" : "insert", result.error); showStoreNotice(supabaseUserMessage(result.error), "error"); return null; }
    await loadCloudFavorites(); return !exists;
  } catch (error) { reportSupabaseError("favoritos", "toggleFavorite", error); showStoreNotice(supabaseUserMessage(error), "error"); return null; }
}

function isFavorite(productId){ return getFavorites().includes(productId); }
function updateFavCount(){ document.querySelectorAll(".js-fav-count").forEach(el => { const count = getFavorites().length; el.textContent = count; el.style.display = count ? "flex" : "none"; }); }

document.addEventListener("DOMContentLoaded", async () => {
  clearCustomerCache();
  if (!window.supabaseClient) return;
  const user = await authenticatedUser();
  if (user){ try { await Promise.all([loadCloudCart(), loadCloudFavorites()]); } catch (error) { reportSupabaseError("carrinho/favoritos", "carregamento inicial", error); } }
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) clearCustomerCache();
    else Promise.all([loadCloudCart(), loadCloudFavorites()]).catch(error => reportSupabaseError("carrinho/favoritos", "mudança de sessão", error));
  });
});
