/* Editor de variações: módulo independente e aditivo ao CRUD existente. */
(function () {
  "use strict";
  var colors = [], productId = null;
  var BUCKET = "produtos", TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }, MAX = 5 * 1024 * 1024;
  function $(s) { return document.querySelector(s); }
  function uid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"); }
  function render() {
    var box = $("#variantRows"); if (!box) return; box.innerHTML = "";
    colors.forEach(function (c, index) {
      var images = c.images.map(function (p, imageIndex) { return '<div class="adm-variant-photo"><img src="' + esc(p.preview || p.url) + '" alt=""><button type="button" data-vremove-photo="' + index + ':' + imageIndex + '">Remover</button></div>'; }).join("");
      var row = document.createElement("article"); row.className = "adm-variant-row";
      row.innerHTML = '<div class="adm-variant-head"><label>Cor <input class="adm-control" data-vname="' + index + '" value="' + esc(c.nome) + '" maxlength="60" placeholder="Ex.: Preto"></label><button type="button" class="adm-linkdanger" data-vremove="' + index + '">Remover cor</button></div>' +
        '<div class="adm-row2"><label class="adm-field">P <input class="adm-control" data-vstock="' + index + ':P" type="number" min="0" step="1" value="' + c.stock.P + '"></label><label class="adm-field">M <input class="adm-control" data-vstock="' + index + ':M" type="number" min="0" step="1" value="' + c.stock.M + '"></label><label class="adm-field">G <input class="adm-control" data-vstock="' + index + ':G" type="number" min="0" step="1" value="' + c.stock.G + '"></label></div>' +
        '<div class="adm-variant-photos">' + images + '</div><label class="adm-fieldhelp">Fotos desta cor (' + c.images.length + '/2)<input type="file" data-vupload="' + index + '" accept="image/jpeg,image/png,image/webp" ' + (c.images.length >= 2 ? 'disabled' : '') + '></label>';
      box.append(row);
    });
  }
  function fresh() { return { id: null, nome: "", images: [], stock: { P: 0, M: 0, G: 0 } }; }
  async function load(id) {
    productId = id || null; colors = [];
    if (!productId) { render(); return; }
    var r = await supabaseClient.from("produto_cores").select("id,nome,imagens,produto_variacoes(id,tamanho,estoque)").eq("produto_id", productId).order("criado_em");
    if (r.error) { console.warn("[Variacoes]", r.error); render(); return; }
    colors = (r.data || []).map(function (c) { var stock={P:0,M:0,G:0}; (c.produto_variacoes || []).forEach(function(v){ stock[v.tamanho]=Number(v.estoque)||0; }); return { id:c.id,nome:c.nome,images:(Array.isArray(c.imagens)?c.imagens:[]).map(function(url){return {url:url,preview:url,file:null};}),stock:stock }; }); render();
  }
  function validate() { var used={}; for(var i=0;i<colors.length;i++){var c=colors[i];c.nome=c.nome.trim().replace(/\s+/g," ");if(!c.nome) return "Informe o nome de cada cor.";var key=c.nome.toLowerCase();if(used[key])return "Não repita o nome de uma cor.";used[key]=true;for(var s in c.stock){if(!Number.isInteger(c.stock[s])||c.stock[s]<0)return "O estoque deve ser um número inteiro igual ou maior que zero.";}} return null; }
  async function upload(color) { for(var i=0;i<color.images.length;i++){var p=color.images[i];if(!p.file)continue;var ext=TYPES[p.file.type],path="products/variants/"+uid()+"."+ext,r=await supabaseClient.storage.from(BUCKET).upload(path,p.file,{cacheControl:"31536000",upsert:false,contentType:p.file.type});if(r.error)throw r.error;var pub=supabaseClient.storage.from(BUCKET).getPublicUrl(path);p.url=pub.data.publicUrl;} return color.images.map(function(p){return p.url;}); }
  async function save(id) {
    productId=id; var error=validate(); if(error) return {ok:false,message:error};
    var existing=await supabaseClient.from("produto_cores").select("id").eq("produto_id",id); if(existing.error)return {ok:false,message:"Não foi possível salvar as variações."};
    var keep=colors.filter(function(c){return c.id;}).map(function(c){return c.id;});
    var old=(existing.data||[]).map(function(c){return c.id;}).filter(function(oldId){return keep.indexOf(oldId)===-1;});
    if(old.length){var del=await supabaseClient.from("produto_cores").delete().in("id",old);if(del.error)return {ok:false,message:"Não foi possível remover uma cor."};}
    for(var i=0;i<colors.length;i++){var c=colors[i], urls;try{urls=await upload(c);}catch(e){return {ok:false,message:"Não foi possível enviar uma foto da cor."};}var body={produto_id:id,nome:c.nome,imagens:urls};var row=c.id?await supabaseClient.from("produto_cores").update(body).eq("id",c.id).select("id").single():await supabaseClient.from("produto_cores").insert(body).select("id").single();if(row.error)return {ok:false,message:"Não foi possível salvar a cor."};c.id=row.data.id;var vars=["P","M","G"].map(function(t){return {produto_cor_id:c.id,tamanho:t,estoque:c.stock[t]};});var v=await supabaseClient.from("produto_variacoes").upsert(vars,{onConflict:"produto_cor_id,tamanho"});if(v.error)return {ok:false,message:"Não foi possível salvar o estoque por tamanho."};}
    return {ok:true};
  }
  document.addEventListener("DOMContentLoaded",function(){var add=$("#addVariantColor"),box=$("#variantRows");if(!add||!box)return;add.onclick=function(){colors.push(fresh());render();};box.addEventListener("input",function(e){var t=e.target;if(t.dataset.vname!==undefined)colors[Number(t.dataset.vname)].nome=t.value;if(t.dataset.vstock){var a=t.dataset.vstock.split(":"),n=Number(t.value);colors[Number(a[0])].stock[a[1]]=Number.isInteger(n)&&n>=0?n:0;}});box.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;if(b.dataset.vremove!==undefined){colors.splice(Number(b.dataset.vremove),1);render();}if(b.dataset.vremovePhoto){var a=b.dataset.vremovePhoto.split(":"),p=colors[Number(a[0])].images.splice(Number(a[1]),1)[0];if(p&&p.file&&p.preview)URL.revokeObjectURL(p.preview);render();}});box.addEventListener("change",function(e){var input=e.target;if(input.dataset.vupload===undefined)return;var c=colors[Number(input.dataset.vupload)];Array.prototype.forEach.call(input.files||[],function(file){if(c.images.length>=2)return;if(!TYPES[file.type]||file.size>MAX)return;c.images.push({file:file,preview:URL.createObjectURL(file),url:null});});render();});});
  window.UGCVariants={load:load,save:save};
})();
