/* Estado de carrinho e favoritos — hoje em localStorage, estrutura pronta
   para ser trocada por chamadas de API/backend na próxima etapa do projeto. */

const CART_KEY = "ugc_cart";
const FAV_KEY = "ugc_favorites";

function readStore(key){
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch(e){ return []; }
}
function writeStore(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function getCart(){ return readStore(CART_KEY); }

function addToCart(productId, size, color, qty = 1){
  const cart = getCart();
  const existing = cart.find(i => i.productId === productId && i.size === size && i.color === color);
  if (existing) { existing.qty += qty; }
  else { cart.push({ productId, size, color, qty }); }
  writeStore(CART_KEY, cart);
  updateCartCount();
}

function removeFromCart(index){
  const cart = getCart();
  cart.splice(index, 1);
  writeStore(CART_KEY, cart);
  updateCartCount();
}

function updateCartQty(index, qty){
  const cart = getCart();
  if (!cart[index]) return;
  cart[index].qty = Math.max(1, qty);
  writeStore(CART_KEY, cart);
  updateCartCount();
}

function cartCount(){
  return getCart().reduce((sum, i) => sum + i.qty, 0);
}

function cartSubtotal(){
  return getCart().reduce((sum, i) => {
    const p = getProductById(i.productId);
    return p ? sum + p.price * i.qty : sum;
  }, 0);
}

function updateCartCount(){
  document.querySelectorAll(".js-cart-count").forEach(el => {
    const n = cartCount();
    el.textContent = n;
    el.style.display = n > 0 ? "flex" : "none";
  });
}

/* ===== favoritos ===== */
function getFavorites(){ return readStore(FAV_KEY); }

function toggleFavorite(productId){
  let favs = getFavorites();
  if (favs.includes(productId)) favs = favs.filter(id => id !== productId);
  else favs.push(productId);
  writeStore(FAV_KEY, favs);
  updateFavCount();
  return favs.includes(productId);
}

function isFavorite(productId){
  return getFavorites().includes(productId);
}

function updateFavCount(){
  document.querySelectorAll(".js-fav-count").forEach(el => {
    const n = getFavorites().length;
    el.textContent = n;
    el.style.display = n > 0 ? "flex" : "none";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  updateCartCount();
  updateFavCount();
});
