/* Componentes reutilizáveis de layout: header, footer, drawer de carrinho,
   menu mobile e card de produto. Injeta-se via mountLayout() em cada página. */

const ICONS = {
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.6-3.6 4.8-5.5 8-5.5s6.4 1.9 8 5.5"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 20s-7.5-4.8-9.7-9.4C.8 7 2.4 3.6 6 3c2.3-.4 4.4.9 6 3 1.6-2.1 3.7-3.4 6-3 3.6.6 5.2 4 3.7 7.6C19.5 15.2 12 20 12 20z"/></svg>`,
  bag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>`,
  minus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="7" width="14" height="10"/><path d="M15 10h4l3 3v4h-7z"/><circle cx="6" cy="19" r="1.6"/><circle cx="17.5" cy="19" r="1.6"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3z"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M21 12a8 8 0 1 1-3.3-6.5L21 4l-1 4.3A7.9 7.9 0 0 1 21 12z"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M20 12 12.7 4.7a2 2 0 0 0-1.4-.6H5a1 1 0 0 0-1 1v6.3c0 .5.2 1 .6 1.4L11.9 20a2 2 0 0 0 2.8 0L20 14.8a2 2 0 0 0 0-2.8z"/><circle cx="8.5" cy="8.5" r="1.2"/></svg>`
};

function headerTemplate(){
  return `
  <div class="announce">FRETE GRÁTIS PARA TODO O BRASIL EM COMPRAS ACIMA DE R$ 399</div>
  <header class="site-header">
    <div class="wrap header-row">
      <button class="menu-toggle" id="menuToggle" aria-label="Abrir menu" aria-controls="mobileNav" aria-expanded="false">${ICONS.menu}</button>
      <nav class="nav-primary">
        <a href="catalogo.html?cat=novidades">Novidades</a>
        <a href="catalogo.html?cat=vestidos">Vestidos</a>
        <a href="catalogo.html?cat=conjuntos">Conjuntos</a>
        <a href="catalogo.html?cat=blusas">Blusas</a>
        <a href="catalogo.html?cat=calcas">Calças</a>
        <a href="catalogo.html?cat=saias">Saias</a>
        <a href="catalogo.html?cat=promocoes">Promoções</a>
      </nav>
      <a href="index.html" class="brand">use <span>giselly cristine</span></a>
      <div class="header-actions">
        <button class="icon-btn" id="searchToggle" aria-label="Abrir busca" aria-controls="searchLine" aria-expanded="false">${ICONS.search}</button>
        <a href="conta.html" class="icon-btn" aria-label="Conta">${ICONS.user}</a>
        <a href="conta.html?tab=favoritos" class="icon-btn" aria-label="Favoritos">
          ${ICONS.heart}<span class="icon-count js-fav-count" style="display:none">0</span>
        </a>
        <button class="icon-btn" id="cartToggle" aria-label="Abrir carrinho" aria-controls="cartDrawer" aria-expanded="false">
          ${ICONS.bag}<span class="icon-count js-cart-count" style="display:none">0</span>
        </button>
      </div>
    </div>
    <div class="search-line" id="searchLine">
      <div class="wrap search-inner">
        <input type="search" placeholder="Buscar vestidos, conjuntos, blusas…" aria-label="Buscar produtos" />
        <button class="search-close" id="searchClose" aria-label="Fechar busca">${ICONS.close}</button>
      </div>
    </div>
  </header>

  <div class="mobile-backdrop" id="mobileBackdrop"></div>
  <nav class="mobile-nav" id="mobileNav">
    <div class="mobile-nav-head">
      <span class="mobile-nav-title">Menu</span>
      <button class="mobile-close" id="mobileClose" aria-label="Fechar menu">${ICONS.close}</button>
    </div>
    <div class="mobile-nav-links">
      <a href="catalogo.html?cat=novidades">Novidades</a>
      <a href="catalogo.html?cat=vestidos">Vestidos</a>
      <a href="catalogo.html?cat=conjuntos">Conjuntos</a>
      <a href="catalogo.html?cat=blusas">Blusas</a>
      <a href="catalogo.html?cat=calcas">Calças</a>
      <a href="catalogo.html?cat=saias">Saias</a>
      <a href="catalogo.html?cat=promocoes">Promoções</a>
    </div>
    <a class="mobile-account-link" href="conta.html">Minha conta</a>
  </nav>

  <aside class="cart-drawer" id="cartDrawer">
    <div class="cart-drawer-head">
      <h3>Sua sacola</h3>
      <button id="cartClose" aria-label="Fechar carrinho">${ICONS.close}</button>
    </div>
    <div class="cart-drawer-body" id="cartDrawerBody"></div>
    <div class="cart-drawer-foot" id="cartDrawerFoot"></div>
  </aside>`;
}

function footerTemplate(){
  return `
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <a href="index.html" class="brand">use <span style="color:var(--camel)">giselly cristine</span></a>
      <p>Moda feminina autoral, pensada para quem se veste com intenção. Work smarter. Live better.</p>
      <div class="social-row">
        <a href="#" aria-label="Instagram">${ICONS.tag}</a>
        <a href="#" aria-label="Whatsapp">${ICONS.chat}</a>
      </div>
    </div>
    <div>
      <h4>Institucional</h4>
      <ul>
        <li><a href="#">Sobre a marca</a></li>
        <li><a href="#">Nossas coleções</a></li>
        <li><a href="#">Trabalhe conosco</a></li>
        <li><a href="#">Política de privacidade</a></li>
      </ul>
    </div>
    <div>
      <h4>Atendimento</h4>
      <ul>
        <li><a href="#">Fale conosco</a></li>
        <li><a href="#">Trocas e devoluções</a></li>
        <li><a href="#">Guia de medidas</a></li>
        <li><a href="#">Perguntas frequentes</a></li>
      </ul>
    </div>
    <div>
      <h4>Formas de pagamento</h4>
      <div class="payment-row">
        <span>Pix</span><span>Visa</span><span>Mastercard</span><span>Elo</span><span>Boleto</span>
      </div>
      <h4 style="margin-top:1.6rem">Newsletter</h4>
      <p style="margin-bottom:.6rem">Novidades e ofertas em primeira mão.</p>
      <div style="display:flex;gap:.4rem">
        <input type="email" placeholder="seu e-mail" style="flex:1;background:transparent;border:1px solid #4E463F;color:#fff;padding:.6rem .7rem;font-size:.8rem" />
        <button class="btn" style="background:var(--camel);border-color:var(--camel);color:var(--ink);padding:.6rem 1rem">OK</button>
      </div>
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>© 2026 Use Giselly Cristine — todos os direitos reservados</span>
    <span>Desenvolvido por Brenkee</span>
  </div>`;
}

function productCardHTML(p){
  const favActive = isFavorite(p.id) ? "active" : "";
  const badge = p.isNew ? `<span class="tag-badge">Novo</span>` : (p.oldPrice ? `<span class="tag-badge">Oferta</span>` : "");
  return `
  <article class="product-card">
    <div class="product-media">
      ${badge}
      <button class="fav-btn ${favActive}" data-fav="${p.id}" aria-label="Favoritar">${ICONS.heart}</button>
      <a href="produto.html?id=${p.id}">
        <img class="img-a" src="${p.images[0]}" alt="${p.name}" loading="lazy" />
        <img class="img-b" src="${p.images[1] || p.images[0]}" alt="" loading="lazy" />
      </a>
      <div class="quick-add">
        <button class="btn btn-block" data-quickadd="${p.id}">Adicionar à sacola</button>
      </div>
    </div>
    <div class="product-info">
      <a href="produto.html?id=${p.id}" class="p-name">${p.name}</a>
      <div class="p-price">
        ${p.oldPrice ? `<span class="old">${formatBRL(p.oldPrice)}</span><span class="now">${formatBRL(p.price)}</span>` : `<span>${formatBRL(p.price)}</span>`}
      </div>
    </div>
  </article>`;
}

function renderCartDrawer(){
  const body = document.getElementById("cartDrawerBody");
  const foot = document.getElementById("cartDrawerFoot");
  if (!body) return;
  const cart = getCart();
  if (cart.length === 0){
    body.innerHTML = `<p style="color:var(--ink-soft);font-size:.9rem">Sua sacola está vazia.</p>`;
    foot.innerHTML = `<a href="catalogo.html" class="btn btn-block">Ver novidades</a>`;
    return;
  }
  body.innerHTML = cart.map((item, idx) => {
    const p = getProductById(item.productId);
    if (!p) return "";
    return `
    <div class="cart-line">
      <img src="${p.images[0]}" alt="${p.name}" />
      <div style="flex:1">
        <div class="ci-name">${p.name}</div>
        <div class="ci-meta">Tam. ${item.size} · ${item.color}</div>
        <div class="qty-box" style="margin-top:.5rem">
          <button data-qty-minus="${idx}">${ICONS.minus}</button>
          <span>${item.qty}</span>
          <button data-qty-plus="${idx}">${ICONS.plus}</button>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:.85rem">${formatBRL(p.price * item.qty)}</div>
        <button class="ci-remove" data-remove="${idx}">remover</button>
      </div>
    </div>`;
  }).join("");

  foot.innerHTML = `
    <div class="cart-subtotal-row"><span>Subtotal</span><strong>${formatBRL(cartSubtotal())}</strong></div>
    <a href="carrinho.html" class="btn btn-outline btn-block" style="margin-bottom:.6rem">Ver sacola</a>
    <a href="checkout.html" class="btn btn-wine btn-block">Finalizar compra</a>`;
}

function bindLayoutEvents(){
  const menuToggle = document.getElementById("menuToggle");
  const mobileNav = document.getElementById("mobileNav");
  const mobileBackdrop = document.getElementById("mobileBackdrop");
  const mobileClose = document.getElementById("mobileClose");
  const openMobile = () => {
    mobileNav.classList.add("open");
    mobileBackdrop.classList.add("open");
    menuToggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("nav-is-open");
    mobileClose && mobileClose.focus();
  };
  const closeMobile = () => {
    mobileNav.classList.remove("open");
    mobileBackdrop.classList.remove("open");
    menuToggle && menuToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-is-open");
  };
  menuToggle && menuToggle.addEventListener("click", openMobile);
  mobileClose && mobileClose.addEventListener("click", closeMobile);
  mobileBackdrop && mobileBackdrop.addEventListener("click", closeMobile);

  const searchToggle = document.getElementById("searchToggle");
  const searchLine = document.getElementById("searchLine");
  const searchClose = document.getElementById("searchClose");
  const searchInput = searchLine && searchLine.querySelector("input");
  const openSearch = () => {
    searchLine.classList.add("open");
    searchToggle.setAttribute("aria-expanded", "true");
    searchToggle.setAttribute("aria-label", "Fechar busca");
    searchInput && searchInput.focus();
  };
  const closeSearch = () => {
    searchLine.classList.remove("open");
    searchToggle && searchToggle.setAttribute("aria-expanded", "false");
    searchToggle && searchToggle.setAttribute("aria-label", "Abrir busca");
  };
  searchToggle && searchToggle.addEventListener("click", () => searchLine.classList.contains("open") ? closeSearch() : openSearch());
  searchClose && searchClose.addEventListener("click", closeSearch);

  const cartToggle = document.getElementById("cartToggle");
  const cartClose = document.getElementById("cartClose");
  const cartDrawer = document.getElementById("cartDrawer");
  const openCart = () => {
    renderCartDrawer();
    cartDrawer.classList.add("open");
    mobileBackdrop.classList.add("open");
    cartToggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("nav-is-open");
    cartClose && cartClose.focus();
  };
  const closeCart = () => {
    cartDrawer.classList.remove("open");
    mobileBackdrop.classList.remove("open");
    cartToggle && cartToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-is-open");
  };
  cartToggle && cartToggle.addEventListener("click", openCart);
  cartClose && cartClose.addEventListener("click", closeCart);
  mobileBackdrop && mobileBackdrop.addEventListener("click", closeCart);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeSearch();
    closeMobile();
    closeCart();
  });

  document.body.addEventListener("click", (e) => {
    const favBtn = e.target.closest("[data-fav]");
    if (favBtn){
      const active = toggleFavorite(favBtn.dataset.fav);
      favBtn.classList.toggle("active", active);
    }
    const quickAdd = e.target.closest("[data-quickadd]");
    if (quickAdd){
      const p = getProductById(quickAdd.dataset.quickadd);
      addToCart(p.id, p.sizes[Math.floor(p.sizes.length/2)], p.colors[0].name, 1);
      quickAdd.textContent = "Adicionado ✓";
      setTimeout(() => quickAdd.textContent = "Adicionar à sacola", 1400);
    }
    const qtyMinus = e.target.closest("[data-qty-minus]");
    if (qtyMinus){
      const idx = +qtyMinus.dataset.qtyMinus;
      const cart = getCart();
      updateCartQty(idx, cart[idx].qty - 1);
      renderCartDrawer();
    }
    const qtyPlus = e.target.closest("[data-qty-plus]");
    if (qtyPlus){
      const idx = +qtyPlus.dataset.qtyPlus;
      const cart = getCart();
      updateCartQty(idx, cart[idx].qty + 1);
      renderCartDrawer();
    }
    const remove = e.target.closest("[data-remove]");
    if (remove){
      removeFromCart(+remove.dataset.remove);
      renderCartDrawer();
    }
  });
}

function mountLayout(activeCategory){
  document.getElementById("headerMount").innerHTML = headerTemplate();
  document.getElementById("footerMount").innerHTML = footerTemplate();
  if (activeCategory){
    document.querySelectorAll(`.nav-primary a[href*="cat=${activeCategory}"]`).forEach(a => a.classList.add("active"));
  }
  bindLayoutEvents();
  updateCartCount();
  updateFavCount();
}
