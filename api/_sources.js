// Vishwa Samvad Kendra (VSK) network — regional & national sites.
// Keep in sync with VSK_NETWORK in index.html (the source picker).
// `domain` is the bare registrable domain (used for site: queries / allow-lists).

export const VSK_NETWORK = [
  { name: "VSK Bharat",        domain: "vskbharat.com",   region: "National" },
  { name: "VSK Delhi",         domain: "ivskdelhi.in",    region: "Delhi" },
  { name: "Samvad",            domain: "samvad.in",       region: "National" },
  { name: "VSK Gujarat",       domain: "vskgujarat.com",  region: "Gujarat" },
  { name: "VSK Jaipur",        domain: "vskjaipur.com",   region: "Rajasthan (Jaipur)" },
  { name: "VSK Pune",          domain: "vskpune.org",     region: "Maharashtra (Pune)" },
  { name: "VSK Mumbai",        domain: "vskmumbai.org",   region: "Maharashtra (Mumbai/Konkan)" },
  { name: "VSK Karnataka",     domain: "vskkarnataka.org",region: "Karnataka" },
  { name: "VSK Telangana",     domain: "vsktelangana.org",region: "Telangana" },
  { name: "VSK Andhra",        domain: "vskandhra.org",   region: "Andhra Pradesh" },
  { name: "VSK Kerala",        domain: "vskkerala.com",   region: "Kerala" },
  { name: "VSK Tamil Nadu",    domain: "vsktamilnadu.org",region: "Tamil Nadu" },
  { name: "VSK Bihar",         domain: "vskbihar.com",    region: "Bihar" },
  { name: "VSK Assam",         domain: "vskassam.org",    region: "Assam" },
  { name: "VSK Silchar",       domain: "vsksilchar.org",  region: "Assam (Barak Valley / Silchar)" },
  { name: "VSK Awadh",         domain: "vskawadh.com",    region: "Uttar Pradesh (Awadh)" }
];

export const VSK_DOMAINS = VSK_NETWORK.map(s => s.domain);
