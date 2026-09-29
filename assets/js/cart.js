/* Carrinho e favoritos: localStorage para visitantes e espelho do Supabase para clientes autenticados. */
const CART_KEY = "ugc_cart";
const FAV_KEY = "ugc_favorites";
let cloudQueue = Promise.resolve();
let migratedCartForUser = null;

function readStore(key){ try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }
function writeStore(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
function getCart(){ return readStore(CART_KEY); }
function getFavorites(){ return readStore(FAV_KEY); }
function currentSession(){ return window.supabaseClient ? supabaseClient.auth.getSession() : Promise.resolve({ data:{ session:null } }); }
function notifyCartChange(){ updateCartCount(); document.dispatchEvent(new CustomEvent("ugc:cart-updated")); }

async function getCloudCart(userId){
  let { data, error } = await supabaseClient.from("carrinhos").select("id").eq("usuario_id", userId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  ({ data, error } = await supabaseClient.from("carrinhos").insert({ usuario_id:userId }).select("id").single());
  if (error) throw error;
  return data;
}

function productSnapshot(item){
  const product = getProductById(item.productId);
  return product && { produto_id:item.productId, nome_produto:product.name, imagem_produto:product.images[0], tamanho:item.size, cor:item.color, quantidade:item.qty, preco_unitario:product.price };
}

async function replaceCloudCart(){
  const { data:{ session } } = await currentSession();
  if (!session) return;
  const cart = await getCloudCart(session.user.id);
  const items = getCart().map(productSnapshot).filter(Boolean);
  const { error: deleteError } = await supabaseClient.from("carrinho_itens").delete().eq("carrinho_id", cart.id);
  if (deleteError) throw deleteError;
  if (items.length){
    const { error } = await supabaseClient.from("carrinho_itens").insert(items.map(item => ({ ...item, carrinho_id:cart.id })));
    if (error) throw error;
  }
  await supabaseClient.from("carrinhos").update({ atualizado_em:new Date().toISOString() }).eq("id", cart.id);
}

function queueCartSync(){
  if (!window.supabaseClient) return;
  cloudQueue = cloudQueue.then(replaceCloudCart).catch(() => {});
}

async function syncCloudCartToLocal(){
  const { data:{ session } } = await currentSession();
  if (!session) return;
  const cart = await getCloudCart(session.user.id);
  const { data: remoteItems, error } = await supabaseClient.from("carrinho_itens").select("produto_id,tamanho,cor,quantidade").eq("carrinho_id", cart.id);
  if (error) throw error;
  const merged = remoteItems.map(item => ({ productId:item.produto_id, size:item.tamanho, color:item.cor, qty:item.quantidade }));
  if (migratedCartForUser !== session.user.id){
    getCart().forEach(local => {
      const found = merged.find(item => item.productId === local.productId && item.size === local.size && item.color === local.color);
      if (found) found.qty += local.qty;
      else merged.push(local);
    });
    migratedCartForUser = session.user.id;
  }
  writeStore(CART_KEY, merged);
  await replaceCloudCart();
  notifyCartChange();
}

function addToCart(productId, size, color, qty = 1){
  const cart = getCart();
  const existing = cart.find(item => item.productId === productId && item.size === size && item.color === color);
  if (existing) existing.qty += qty; else cart.push({ productId, size, color, qty });
  writeStore(CART_KEY, cart); notifyCartChange(); queueCartSync();
}
function removeFromCart(index){ const cart = getCart(); cart.splice(index, 1); writeStore(CART_KEY, cart); notifyCartChange(); queueCartSync(); }
function updateCartQty(index, qty){ const cart = getCart(); if (!cart[index]) return; cart[index].qty = Math.max(1, qty); writeStore(CART_KEY, cart); notifyCartChange(); queueCartSync(); }
function cartCount(){ return getCart().reduce((sum,item) => sum + item.qty, 0); }
function cartSubtotal(){ return getCart().reduce((sum,item) => { const product = getProductById(item.productId); return product ? sum + product.price * item.qty : sum; }, 0); }
function updateCartCount(){ document.querySelectorAll(".js-cart-count").forEach(el => { const count = cartCount(); el.textContent = count; el.style.display = count > 0 ? "flex" : "none"; }); }

async function syncCloudFavoritesToLocal(){
  const { data:{ session } } = await currentSession();
  if (!session) return;
  const { data, error } = await supabaseClient.from("favoritos").select("produto_id").eq("usuario_id", session.user.id);
  if (error) throw error;
  writeStore(FAV_KEY, data.map(item => item.produto_id)); updateFavCount();
}

async function toggleFavorite(productId){
  const { data:{ session } } = await currentSession();
  if (!session){
    location.href = `conta.html?tab=entrar&returnTo=${encodeURIComponent(location.pathname + location.search)}`;
    return null;
  }
  const favorites = getFavorites();
  const exists = favorites.includes(productId);
  const product = getProductById(productId);
  const request = exists
    ? supabaseClient.from("favoritos").delete().eq("usuario_id", session.user.id).eq("produto_id", productId)
    : supabaseClient.from("favoritos").insert({ usuario_id:session.user.id, produto_id:productId, nome_produto:product?.name || null, imagem_produto:product?.images?.[0] || null });
  const { error } = await request;
  if (error) return null;
  const next = exists ? favorites.filter(id => id !== productId) : [...favorites, productId];
  writeStore(FAV_KEY, next); updateFavCount();
  return !exists;
}
function isFavorite(productId){ return getFavorites().includes(productId); }
function updateFavCount(){ document.querySelectorAll(".js-fav-count").forEach(el => { const count = getFavorites().length; el.textContent = count; el.style.display = count > 0 ? "flex" : "none"; }); }

document.addEventListener("DOMContentLoaded", async () => {
  updateCartCount(); updateFavCount();
  if (!window.supabaseClient) return;
  const { data:{ session } } = await currentSession();
  if (session){ try { await syncCloudCartToLocal(); await syncCloudFavoritesToLocal(); } catch {} }
  supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
    if (nextSession) { syncCloudCartToLocal().catch(() => {}); syncCloudFavoritesToLocal().catch(() => {}); }
  });
});
