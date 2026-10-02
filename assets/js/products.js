/* USE GISELLY CRISTINE — catálogo fictício de demonstração.
   Estrutura pensada para depois ser substituída por dados reais de um banco/API. */

const IMG = (q, n) => `https://source.unsplash.com/600x800/?${encodeURIComponent(q)}&sig=${n}`;

const PRODUCTS = [
  {
    id: "vestido-midi-elegance",
    name: "Vestido Midi Elegance",
    category: "vestidos",
    price: 429.90,
    oldPrice: null,
    isNew: true,
    colors: [{ name: "Vinho", hex: "#6E2430" }, { name: "Preto", hex: "#221C19" }],
    sizes: ["PP", "P", "M", "G"],
    images: [IMG("woman,elegant,dress", 1), IMG("woman,dress,fashion", 2), IMG("dress,studio", 3)],
    description: "Corte midi em tecido fluido, decote em V e amarração na cintura. Peça autoral da coleção atual, pensada para o dia a dia com um toque de sofisticação."
  },
  {
    id: "conjunto-essential",
    name: "Conjunto Essential",
    category: "conjuntos",
    price: 389.90,
    oldPrice: 459.90,
    isNew: false,
    colors: [{ name: "Areia", hex: "#C3985F" }, { name: "Off White", hex: "#F1EBDE" }],
    sizes: ["P", "M", "G", "GG"],
    images: [IMG("woman,linen,set", 4), IMG("woman,fashion,outfit", 5), IMG("clothing,set", 6)],
    description: "Blazer alfaiataria e calça pantalona em tecido de caimento leve. Conjunto essencial para compor looks de trabalho ou eventos com elegância discreta."
  },
  {
    id: "blusa-aurora",
    name: "Blusa Aurora",
    category: "blusas",
    price: 179.90,
    oldPrice: null,
    isNew: true,
    colors: [{ name: "Marfim", hex: "#F1EBDE" }, { name: "Camel", hex: "#C3985F" }],
    sizes: ["PP", "P", "M", "G"],
    images: [IMG("woman,blouse,silk", 7), IMG("blouse,fashion", 8), IMG("woman,shirt", 9)],
    description: "Blusa em cetim com mangas amplas e botões forrados. Um básico atemporal que eleva qualquer produção."
  },
  {
    id: "calca-alfaiataria-classic",
    name: "Calça Alfaiataria Classic",
    category: "calcas",
    price: 259.90,
    oldPrice: 299.90,
    isNew: false,
    colors: [{ name: "Preto", hex: "#221C19" }, { name: "Vinho", hex: "#6E2430" }],
    sizes: ["36", "38", "40", "42", "44"],
    images: [IMG("woman,trousers,fashion", 10), IMG("pants,studio", 11), IMG("woman,pants", 12)],
    description: "Modelagem reta de cintura alta com vinco frontal. Tecido estruturado que mantém o caimento perfeito durante todo o dia."
  },
  {
    id: "saia-plissada-noir",
    name: "Saia Plissada Noir",
    category: "saias",
    price: 219.90,
    oldPrice: null,
    isNew: true,
    colors: [{ name: "Preto", hex: "#221C19" }],
    sizes: ["P", "M", "G"],
    images: [IMG("woman,pleated,skirt", 13), IMG("skirt,fashion", 14), IMG("woman,skirt,studio", 15)],
    description: "Saia midi plissada com cós elástico. Movimento e leveza para o dia a dia, do escritório ao happy hour."
  },
  {
    id: "vestido-longo-atelier",
    name: "Vestido Longo Atelier",
    category: "vestidos",
    price: 549.90,
    oldPrice: 649.90,
    isNew: false,
    colors: [{ name: "Vinho", hex: "#6E2430" }, { name: "Verde Musgo", hex: "#4B5842" }],
    sizes: ["P", "M", "G"],
    images: [IMG("woman,evening,gown", 16), IMG("long,dress,fashion", 17), IMG("woman,elegant,gown", 18)],
    description: "Vestido longo em crepe com fenda lateral e alças reguláveis. Ideal para ocasiões especiais que pedem presença."
  },
  {
    id: "conjunto-linen-summer",
    name: "Conjunto Linen Summer",
    category: "conjuntos",
    price: 349.90,
    oldPrice: null,
    isNew: true,
    colors: [{ name: "Off White", hex: "#F1EBDE" }, { name: "Areia", hex: "#C3985F" }],
    sizes: ["PP", "P", "M", "G"],
    images: [IMG("woman,summer,linen", 19), IMG("linen,outfit", 20), IMG("woman,casual,chic", 21)],
    description: "Top cropped e short em linho puro. Conjunto leve para dias quentes sem abrir mão do estilo."
  },
  {
    id: "blusa-seda-noite",
    name: "Blusa Seda Noite",
    category: "blusas",
    price: 199.90,
    oldPrice: 239.90,
    isNew: false,
    colors: [{ name: "Preto", hex: "#221C19" }, { name: "Vinho", hex: "#6E2430" }],
    sizes: ["PP", "P", "M", "G", "GG"],
    images: [IMG("woman,silk,top", 22), IMG("silk,blouse", 23), IMG("woman,evening,top", 24)],
    description: "Blusa em seda com gola laço, perfeita para compor looks noturnos com uma calça alfaiataria."
  },
  {
    id: "calca-wide-camel",
    name: "Calça Wide Camel",
    category: "calcas",
    price: 279.90,
    oldPrice: null,
    isNew: true,
    colors: [{ name: "Camel", hex: "#C3985F" }],
    sizes: ["36", "38", "40", "42"],
    images: [IMG("woman,wide,pants", 25), IMG("trousers,camel", 26), IMG("woman,pants,fashion", 27)],
    description: "Pantalona wide leg em alfaiataria camel, cintura alta e caimento fluido do quadril aos pés."
  },
  {
    id: "saia-midi-alfaiataria",
    name: "Saia Midi Alfaiataria",
    category: "saias",
    price: 229.90,
    oldPrice: null,
    isNew: false,
    colors: [{ name: "Vinho", hex: "#6E2430" }, { name: "Preto", hex: "#221C19" }],
    sizes: ["P", "M", "G"],
    images: [IMG("woman,midi,skirt", 28), IMG("skirt,tailoring", 29), IMG("woman,skirt,elegant", 30)],
    description: "Saia midi reta com fenda traseira, em tecido alfaiataria de leve elasticidade para maior conforto."
  },
  {
    id: "vestido-tricot-outono",
    name: "Vestido Tricot Outono",
    category: "vestidos",
    price: 319.90,
    oldPrice: 379.90,
    isNew: false,
    colors: [{ name: "Camel", hex: "#C3985F" }, { name: "Verde Musgo", hex: "#4B5842" }],
    sizes: ["P", "M", "G"],
    images: [IMG("woman,knit,dress", 31), IMG("sweater,dress", 32), IMG("woman,autumn,fashion", 33)],
    description: "Vestido em tricot canelado, modelagem justa ao corpo com gola alta. Conforto e estilo para dias mais frios."
  },
  {
    id: "blusa-cropped-linho",
    name: "Blusa Cropped Linho",
    category: "blusas",
    price: 149.90,
    oldPrice: null,
    isNew: true,
    colors: [{ name: "Off White", hex: "#F1EBDE" }, { name: "Marfim", hex: "#F1EBDE" }],
    sizes: ["PP", "P", "M"],
    images: [IMG("woman,cropped,top", 34), IMG("linen,top,fashion", 35), IMG("woman,summer,top", 36)],
    description: "Blusa cropped em linho com amarração frontal, versátil para compor com saias e calças de cintura alta."
  }
];

/* Preenchido por assets/js/categories.js a partir de public.categorias. */
var CATEGORY_LABELS = {};

function formatBRL(v){
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getProductById(id){
  return PRODUCTS.find(p => p.id === id);
}

function getProductsByCategory(cat){
  if (!cat || cat === "todos") return PRODUCTS;
  if (cat === "novidades") return PRODUCTS.filter(p => p.isNew);
  if (cat === "promocoes") return PRODUCTS.filter(p => p.oldPrice);
  return PRODUCTS.filter(p => p.category === cat);
}
