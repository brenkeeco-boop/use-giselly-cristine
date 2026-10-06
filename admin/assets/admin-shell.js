/* Painel administrativo — casca compartilhada (menu lateral + barra superior no celular).
   Cada página do painel chama AdminShell.mount({ active, user }). Os itens sem "href" ainda não
   existem: aparecem como "Em breve" e não são clicáveis. Para ativar uma seção na próxima etapa,
   basta acrescentar o href dela em NAV. */
(function () {
  "use strict";

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',

    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.3"/>',

    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',

    bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',

    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.8.8 3 2.6 3 5.6"/>',

    ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',

    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',

    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',

    logout: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M16 8l4 4-4 4M20 12H9"/>'
  };

  var NAV = [
    { id: "dashboard", label: "Dashboard", icon: "home", href: "index.html" },

    { id: "produtos", label: "Produtos", icon: "tag", href: "produtos.html" },

    { id: "categorias", label: "Categorias", icon: "grid", href: "categorias.html" },

    { id: "pedidos", label: "Pedidos", icon: "bag", href: "pedidos.html" },

    { id: "clientes", label: "Clientes", icon: "users", href: "clientes.html" },

    { id: "cupons", label: "Cupons", icon: "ticket", href: "cupons.html" },

    { id: "configuracoes", label: "Configurações", icon: "sliders", href: "configuracoes.html" }
  ];

  function icon(name) {
    return '<svg class="adm-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      ICONS[name] +
      "</svg>";
  }

  function navItem(item, active) {
    if (!item.href) {
      return '<li><span class="adm-nav-item is-soon" aria-disabled="true">' +
        icon(item.icon) +
        '<span class="adm-nav-label">' + item.label + '</span><em class="adm-soon-tag">Em breve</em></span></li>';
    }

    var current = item.id === active;

    return '<li><a class="adm-nav-item' +
      (current ? " is-active" : "") +
      '" href="' + item.href + '"' +
      (current ? ' aria-current="page"' : "") +
      ">" +
      icon(item.icon) +
      '<span class="adm-nav-label">' + item.label + "</span></a></li>";
  }

  function mount(options) {
    var active = options.active;

    var side = document.getElementById("admSide");
    var top = document.getElementById("admTop");
    var backdrop = document.getElementById("admBackdrop");

    if (!side || !top || !backdrop) return;

    side.innerHTML =
      '<div class="adm-brand">' +
        '<img src="../assets/images/logo-giselly-cristine-transparent.png" alt="" width="52" height="52">' +
        '<div class="adm-brand-text"><strong>Use Giselly Cristine</strong><span>Painel administrativo</span></div>' +
      "</div>" +

      '<nav class="adm-nav" aria-label="Seções do painel"><ul>' +
        NAV.map(function (i) {
          return navItem(i, active);
        }).join("") +
      "</ul></nav>" +

      '<div class="adm-side-foot">' +
        '<a class="adm-visit" href="../index.html" target="_blank" rel="noopener">Ver a loja <span aria-hidden="true">↗</span></a>' +
        '<div class="adm-user">' +
          '<span class="adm-user-mail" data-user-mail></span>' +
          '<button class="adm-logout" type="button" data-logout>' +
            icon("logout") +
            "<span>Sair</span>" +
          "</button>" +
        "</div>" +
      "</div>";

    top.innerHTML =
      '<button class="adm-iconbtn" type="button" data-menu aria-controls="admSide" aria-expanded="false" aria-label="Abrir menu">' +
        icon("menu") +
      "</button>" +
      '<span class="adm-top-title">Use Giselly Cristine</span>' +
      '<button class="adm-iconbtn" type="button" data-logout aria-label="Sair">' +
        icon("logout") +
      "</button>";

    /* textContent: e-mail nunca entra como HTML */
    var mail = side.querySelector("[data-user-mail]");

    if (mail && options.user) {
      mail.textContent = options.user.email || "";
      mail.title = options.user.email || "";
    }

    var menuBtn = top.querySelector("[data-menu]");

    function setOpen(open) {
      side.classList.toggle("open", open);
      backdrop.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
      document.body.classList.toggle("adm-noscroll", open);

      if (open) {
        var first = side.querySelector("a.adm-nav-item, .adm-logout");
        if (first) first.focus();
      } else if (
        document.activeElement &&
        side.contains(document.activeElement)
      ) {
        menuBtn.focus();
      }
    }

    menuBtn.addEventListener("click", function () {
      setOpen(!side.classList.contains("open"));
    });

    backdrop.addEventListener("click", function () {
      setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && side.classList.contains("open")) {
        setOpen(false);
      }
    });

    window.matchMedia("(min-width: 901px)").addEventListener("change", function (m) {
      if (m.matches) setOpen(false);
    });

    document.querySelectorAll("[data-logout]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        window.AdminAuth.logout();
      });
    });
  }

  window.AdminShell = {
    mount: mount
  };
})();
