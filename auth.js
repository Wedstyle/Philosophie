/* ============================================================
   AUTH — Supabase + navigation + protection des pages + mentions
   ============================================================ */

const SUPABASE_URL = "https://idizdchswmvijfoofuiy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkaXpkY2hzd212aWpmb29mdWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzYyMTEsImV4cCI6MjEwNDcxMjIxMX0.TupNcgTT5NQCAq3JHJ9xYvmfQAjn5smNeQNz8ZsIAmM";

let _supabaseChargee = null;
function chargerSupabase() {
  if (_supabaseChargee) return _supabaseChargee;
  _supabaseChargee = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = () => resolve(window.supabase);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _supabaseChargee;
}

let _client = null;
async function client() {
  if (_client) return _client;
  const sdk = await chargerSupabase();
  _client = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

function pseudoVersEmail(pseudo) {
  const clean = pseudo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]/g, "");
  return `${clean}@membres.codex-sith.fr`;
}

function echapper(texte) {
  const div = document.createElement("div");
  div.textContent = texte || "";
  return div.innerHTML;
}

window.SithAuth = {
  async supabase() {
    return await client();
  },

  async session() {
    const c = await client();
    const { data } = await c.auth.getSession();
    return data.session;
  },

  async profil() {
    const s = await this.session();
    if (!s) return null;
    const c = await client();
    const { data, error } = await c
      .from("profils")
      .select("*")
      .eq("id", s.user.id)
      .single();
    if (error) return null;
    return data;
  },

  async inscription(pseudo, motDePasse) {
    if (!pseudo || pseudo.trim().length < 3)
      throw new Error("Le pseudo doit faire au moins 3 caractères.");
    if (!motDePasse || motDePasse.length < 6)
      throw new Error("Le mot de passe doit faire au moins 6 caractères.");
    const email = pseudoVersEmail(pseudo);
    const c = await client();
    const { data, error } = await c.auth.signUp({
      email,
      password: motDePasse,
      options: { data: { pseudo: pseudo.trim() } },
    });
    if (error) {
      if (/already registered/i.test(error.message))
        throw new Error("Ce pseudo est déjà utilisé.");
      throw new Error(error.message);
    }
    return data;
  },

  async connexion(pseudo, motDePasse) {
    const email = pseudoVersEmail(pseudo);
    const c = await client();
    const { data, error } = await c.auth.signInWithPassword({
      email,
      password: motDePasse,
    });
    if (error) {
      if (/invalid login/i.test(error.message))
        throw new Error("Pseudo ou mot de passe incorrect.");
      throw new Error(error.message);
    }
    return data;
  },

  async deconnexion() {
    const c = await client();
    await c.auth.signOut();
    window.location.href = "index.html";
  },

  /* Rôles */
  estMembre(profil) {
    return (
      profil &&
      (profil.role === "membre" ||
        profil.role === "haut_grade" ||
        profil.role === "administrateur" ||
        profil.role === "gerant")
    );
  },
  estHautGrade(profil) {
    return (
      profil &&
      (profil.role === "haut_grade" ||
        profil.role === "administrateur" ||
        profil.role === "gerant")
    );
  },
  estAdmin(profil) {
    return (
      profil && (profil.role === "administrateur" || profil.role === "gerant")
    );
  },
  estGerant(profil) {
    return profil && profil.role === "gerant";
  },
  estBanni(profil) {
    return profil && profil.role === "banni";
  },

  async listerProfils() {
    const c = await client();
    const { data, error } = await c
      .from("profils")
      .select("*")
      .order("cree_le", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async listerMembresPourMentions() {
    const c = await client();
    const { data, error } = await c
      .from("profils")
      .select("id, pseudo, role")
      .in("role", ["membre", "haut_grade", "administrateur", "gerant"])
      .order("pseudo", { ascending: true });
    if (error) return [];
    return data || [];
  },

  async changerRole(id, nouveauRole) {
    const c = await client();
    const { error } = await c
      .from("profils")
      .update({ role: nouveauRole })
      .eq("id", id);
    if (error) throw new Error(error.message);
  },

  /* ==== Mentions ==== */
  async compterMentionsNonLues() {
    const s = await this.session();
    if (!s) return 0;
    const c = await client();
    const { count, error } = await c
      .from("mentions")
      .select("id", { count: "exact", head: true })
      .eq("membre_id", s.user.id)
      .eq("lu", false);
    if (error) return 0;
    return count || 0;
  },

  async compterMentionsParCanal() {
    const s = await this.session();
    if (!s) return {};
    const c = await client();
    const { data, error } = await c
      .from("mentions")
      .select("canal_id")
      .eq("membre_id", s.user.id)
      .eq("lu", false);
    if (error || !data) return {};
    const compteur = {};
    data.forEach((m) => {
      compteur[m.canal_id] = (compteur[m.canal_id] || 0) + 1;
    });
    return compteur;
  },

  async listerMentions() {
    const s = await this.session();
    if (!s) return [];
    const c = await client();
    const { data, error } = await c
      .from("mentions")
      .select(
        `
        id, lu, cree_le, canal_id, message_id,
        messages!inner ( contenu, auteur_pseudo, auteur_id, cree_le ),
        canaux!inner ( nom, icone )
      `,
      )
      .eq("membre_id", s.user.id)
      .order("cree_le", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[mentions]", error);
      return [];
    }
    return data || [];
  },

  async marquerMentionLue(id) {
    const c = await client();
    const { error } = await c
      .from("mentions")
      .update({ lu: true })
      .eq("id", id);
    if (error) throw new Error(error.message);
  },

  async marquerToutesMentionsLues() {
    const s = await this.session();
    if (!s) return;
    const c = await client();
    const { error } = await c
      .from("mentions")
      .update({ lu: true })
      .eq("membre_id", s.user.id)
      .eq("lu", false);
    if (error) throw new Error(error.message);
  },

  async marquerMentionsCanalLues(canalId) {
    const s = await this.session();
    if (!s) return;
    const c = await client();
    await c
      .from("mentions")
      .update({ lu: true })
      .eq("membre_id", s.user.id)
      .eq("canal_id", canalId)
      .eq("lu", false);
  },

  /* ==== Messages non lus ==== */
  async compterNonLus() {
    const c = await client();
    const { data, error } = await c.rpc("compter_non_lus");
    if (error) return {};
    const compteur = {};
    (data || []).forEach((row) => {
      compteur[row.canal_id] = row.nb;
    });
    return compteur;
  },

  async marquerCanalLu(canalId) {
    const c = await client();
    await c.rpc("marquer_canal_lu", { p_canal_id: canalId });
  },
};

/* ==== Cacher / révéler les liens selon le rôle ==== */
function cacherLiensSelonRole() {
  document
    .querySelectorAll('nav.principale a[href="nouvelle-sanction.html"]')
    .forEach((a) => {
      a.closest("li")?.classList.add("lien-membre-cache");
    });
  document
    .querySelectorAll('nav.principale a[href="canaux.html"]')
    .forEach((a) => {
      a.closest("li")?.classList.add("lien-membre-cache");
    });
}
function revelerLiensMembres() {
  document
    .querySelectorAll("nav.principale li.lien-membre-cache")
    .forEach((li) => li.classList.remove("lien-membre-cache"));
}

/* ==== Injection du lien Tableau de bord dans le header ==== */
function injecterLienAdminHeader(profil) {
  if (!window.SithAuth.estAdmin(profil)) return;
  const header = document.querySelector("header");
  if (!header) return;
  if (header.querySelector(".lien-admin-header")) return;

  const pageActuelle = location.pathname.split("/").pop() || "index.html";
  const estSurDashboard = pageActuelle === "tableau-de-bord.html";
  const estGerant = window.SithAuth.estGerant(profil);

  const lien = document.createElement("a");
  lien.href = "tableau-de-bord.html";
  lien.className =
    "lien-admin-header" +
    (estSurDashboard ? " actif" : "") +
    (estGerant ? " gerant" : "");
  lien.innerHTML = estGerant ? "👑 Tableau de bord" : "⚙ Tableau de bord";
  header.appendChild(lien);
}

/* ==== Modale des mentions ==== */
function creerModaleMentions() {
  if (document.getElementById("modale-mentions-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "modale-mentions-overlay";
  overlay.className = "modale-mentions-overlay";
  overlay.innerHTML = `
    <div class="modale-mentions" role="dialog" aria-modal="true" aria-labelledby="modale-mentions-titre">
      <div class="modale-mentions-entete">
        <h2 id="modale-mentions-titre">🔔 Mes mentions</h2>
        <div class="modale-mentions-actions">
          <button type="button" class="btn-tout-lu" id="btn-tout-lu">Tout marquer comme lu</button>
          <button type="button" class="modale-mentions-fermer" id="btn-fermer-mentions" aria-label="Fermer">×</button>
        </div>
      </div>
      <div class="modale-mentions-liste" id="modale-mentions-liste">
        <div class="modale-mentions-vide">Chargement…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) fermerModaleMentions();
  });
  document
    .getElementById("btn-fermer-mentions")
    .addEventListener("click", fermerModaleMentions);
  document.getElementById("btn-tout-lu").addEventListener("click", async () => {
    await window.SithAuth.marquerToutesMentionsLues();
    afficherMentionsDansModale();
    majBadgeMentions();
    document.dispatchEvent(new CustomEvent("mentions-changees"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") fermerModaleMentions();
  });
}

function formatDateRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `il y a ${Math.floor(diff / 86400)} j`;
  return d.toLocaleDateString("fr-FR");
}

async function afficherMentionsDansModale() {
  const liste = document.getElementById("modale-mentions-liste");
  if (!liste) return;
  liste.innerHTML = '<div class="modale-mentions-vide">Chargement…</div>';

  const mentions = await window.SithAuth.listerMentions();
  if (mentions.length === 0) {
    liste.innerHTML =
      '<div class="modale-mentions-vide">Aucune mention pour le moment.</div>';
    return;
  }

  liste.innerHTML = mentions
    .map((m) => {
      const msg = m.messages;
      const canal = m.canaux;
      const extrait =
        (msg?.contenu || "").slice(0, 120) +
        ((msg?.contenu || "").length > 120 ? "…" : "");
      return `
      <div class="mention-ligne ${m.lu ? "lue" : "non-lue"}"
           data-mention-id="${m.id}"
           data-canal-id="${m.canal_id}"
           data-message-id="${m.message_id}">
        <div class="mention-ligne-entete">
          <span class="mention-auteur">⚔ ${echapper(msg?.auteur_pseudo || "?")}</span>
          <span class="mention-canal">${canal?.icone || "💬"} ${echapper(canal?.nom || "?")}</span>
          <span class="mention-date">${formatDateRelative(m.cree_le)}</span>
        </div>
        <div class="mention-extrait">${echapper(extrait)}</div>
      </div>
    `;
    })
    .join("");

  liste.querySelectorAll(".mention-ligne").forEach((ligne) => {
    ligne.addEventListener("click", async () => {
      const mentionId = ligne.getAttribute("data-mention-id");
      const canalId = ligne.getAttribute("data-canal-id");
      const messageId = ligne.getAttribute("data-message-id");
      try {
        await window.SithAuth.marquerMentionLue(mentionId);
      } catch (e) {
        /* ignore */
      }
      window.location.href = `canaux.html?canal=${canalId}&message=${messageId}`;
    });
  });
}

async function ouvrirModaleMentions() {
  creerModaleMentions();
  const overlay = document.getElementById("modale-mentions-overlay");
  overlay.classList.add("visible");
  await afficherMentionsDansModale();
}

function fermerModaleMentions() {
  const overlay = document.getElementById("modale-mentions-overlay");
  if (overlay) overlay.classList.remove("visible");
}

/* ==== Badge navbar ==== */
let _badgeSub = null;

async function majBadgeMentions() {
  const badge = document.getElementById("badge-mentions-btn");
  if (!badge) return;
  const n = await window.SithAuth.compterMentionsNonLues();
  const compteur = badge.querySelector(".badge-count");
  if (n > 0) {
    badge.classList.add("actif");
    compteur.textContent = n > 99 ? "99+" : n;
    compteur.style.display = "";
  } else {
    badge.classList.remove("actif");
    compteur.style.display = "none";
  }
  document.dispatchEvent(
    new CustomEvent("mentions-count-maj", { detail: { count: n } }),
  );
}

async function installerBadgeMentions(profil) {
  return; // 🔕 Badge de mentions désactivé temporairement (canaux fermés)

  if (!window.SithAuth.estMembre(profil)) return;
  const slot = document.querySelector(".nav-auth-slot");
  if (!slot || slot.querySelector("#badge-mentions-btn")) return;

  const badgeBtn = document.createElement("button");
  badgeBtn.id = "badge-mentions-btn";
  badgeBtn.type = "button";
  badgeBtn.className = "badge-mentions-btn";
  badgeBtn.title = "Mes mentions";
  badgeBtn.innerHTML = `
    <span class="badge-icon">🔔</span>
    <span class="badge-count" style="display:none;">0</span>
  `;
  badgeBtn.addEventListener("click", ouvrirModaleMentions);

  const logout = slot.querySelector(".nav-logout");
  if (logout) slot.insertBefore(badgeBtn, logout);
  else slot.appendChild(badgeBtn);

  await majBadgeMentions();

  try {
    const c = await window.SithAuth.supabase();
    const s = await window.SithAuth.session();
    if (s && !_badgeSub) {
      _badgeSub = c
        .channel("mentions-" + s.user.id)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "mentions",
            filter: `membre_id=eq.${s.user.id}`,
          },
          () => majBadgeMentions(),
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "mentions",
            filter: `membre_id=eq.${s.user.id}`,
          },
          () => majBadgeMentions(),
        )
        .subscribe();
    }
  } catch (e) {
    /* ignore */
  }
}

/* ==== Injection du lien auth dans la navbar ==== */
async function injecterLienNavbar() {
  const navUl = document.querySelector("nav.principale ul");
  if (!navUl) return;

  const li = document.createElement("li");
  li.className = "nav-auth-slot";
  navUl.appendChild(li);

  const s = await window.SithAuth.session();
  const profil = s ? await window.SithAuth.profil() : null;

  if (!profil) {
    li.innerHTML = `<a href="connexion.html" class="nav-auth">🔒 Membres</a>`;
    return;
  }

  if (window.SithAuth.estBanni(profil)) {
    li.classList.add("nav-auth-banni");
    li.innerHTML = `
      <span class="nav-banni-label">⛔ Accès révoqué</span>
      <button type="button" class="nav-logout" title="Déconnexion">⏻</button>
    `;
    li.querySelector(".nav-logout").addEventListener("click", () =>
      window.SithAuth.deconnexion(),
    );
    return;
  }

  li.classList.add("nav-auth-connecte");
  li.innerHTML = `
    <a href="registre-local.html" class="nav-auth">⚔ ${profil.pseudo}</a>
    <button type="button" class="nav-logout" title="Déconnexion">⏻</button>
  `;
  li.querySelector(".nav-logout").addEventListener("click", () =>
    window.SithAuth.deconnexion(),
  );

  if (window.SithAuth.estMembre(profil)) revelerLiensMembres();
  injecterLienAdminHeader(profil);

  await installerBadgeMentions(profil);
}

/* ==== Protection des pages ==== */
async function protegerPage() {
  const body = document.body;

  // Page désactivée temporairement
  if (body.dataset.pageDesactivee !== undefined) {
    document.body.innerHTML = `
      <div class="page-refus">
        <h1>Page indisponible</h1>
        <p>Les canaux de discussion sont temporairement fermés.<br>
        Revenez plus tard.</p>
        <a href="index.html" class="btn primary">← Retour à l'accueil</a>
      </div>`;
    return false;
  }

  if (!body.dataset.pageProtegee) return true;

  const s = await window.SithAuth.session();
  if (!s) {
    window.location.replace(
      "connexion.html?next=" +
        encodeURIComponent(location.pathname.split("/").pop()),
    );
    return false;
  }
  const profil = await window.SithAuth.profil();

  if (window.SithAuth.estBanni(profil)) {
    document.body.innerHTML = `
      <div class="page-refus">
        <h1>Accès révoqué</h1>
        <p>Votre accès à la Philosophie Sith a été révoqué.<br>
        Si vous pensez qu'il s'agit d'une erreur, contactez un administrateur.</p>
        <a href="index.html" class="btn primary">← Retour à l'accueil</a>
        <a href="#" class="btn discret" onclick="window.SithAuth.deconnexion();return false;">Se déconnecter</a>
      </div>`;
    return false;
  }

  if (body.dataset.pageAdmin && !window.SithAuth.estAdmin(profil)) {
    document.body.innerHTML = `
      <div class="page-refus">
        <h1>Accès refusé</h1>
        <p>Cette page est réservée aux administrateurs de la Philosophie.</p>
        <a href="index.html" class="btn primary">← Retour à l'accueil</a>
      </div>`;
    return false;
  }

  if (!window.SithAuth.estMembre(profil)) {
    document.body.innerHTML = `
      <div class="page-refus">
        <h1>Accès refusé</h1>
        <p>Votre compte est en attente de validation par la Philosophie.<br>
        Revenez plus tard, ou contactez un haut gradé.</p>
        <a href="index.html" class="btn primary">← Retour à l'accueil</a>
        <a href="#" class="btn discret" onclick="window.SithAuth.deconnexion();return false;">Se déconnecter</a>
      </div>`;
    return false;
  }
  body.dataset.role = profil.role;
  body.dataset.pseudo = profil.pseudo;
  return true;
}

/* ==== Page de connexion ==== */
function initPageConnexion() {
  const tabs = document.querySelectorAll(".onglet-auth");
  const panneaux = document.querySelectorAll(".panneau-auth");
  if (!tabs.length) return;

  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.remove("actif"));
      panneaux.forEach((p) => p.classList.remove("actif"));
      t.classList.add("actif");
      document.getElementById(t.dataset.cible).classList.add("actif");
    }),
  );

  const formLogin = document.getElementById("form-login");
  const formSignup = document.getElementById("form-signup");
  const msgZone = document.getElementById("auth-message");

  function afficherMessage(texte, type = "info") {
    if (!msgZone) return;
    msgZone.textContent = texte;
    msgZone.className = "auth-message " + type;
    msgZone.hidden = !texte;
  }

  if (formLogin) {
    formLogin.addEventListener("submit", async (e) => {
      e.preventDefault();
      afficherMessage("");
      const pseudo = formLogin.querySelector("#login-pseudo").value.trim();
      const mdp = formLogin.querySelector("#login-mdp").value;
      const btn = formLogin.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Connexion…";
      try {
        await window.SithAuth.connexion(pseudo, mdp);
        const next = new URLSearchParams(location.search).get("next");
        window.location.href = next || "index.html";
      } catch (err) {
        afficherMessage(err.message, "erreur");
        btn.disabled = false;
        btn.textContent = "Se connecter";
      }
    });
  }

  if (formSignup) {
    formSignup.addEventListener("submit", async (e) => {
      e.preventDefault();
      afficherMessage("");
      const pseudo = formSignup.querySelector("#signup-pseudo").value.trim();
      const mdp = formSignup.querySelector("#signup-mdp").value;
      const mdp2 = formSignup.querySelector("#signup-mdp2").value;
      if (mdp !== mdp2) {
        afficherMessage(
          "Les deux mots de passe ne correspondent pas.",
          "erreur",
        );
        return;
      }
      const btn = formSignup.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Inscription…";
      try {
        await window.SithAuth.inscription(pseudo, mdp);
        afficherMessage(
          "Votre compte a bien été créé. Il est actuellement en attente de validation par la Philosophie. Vous pourrez vous connecter dès qu'un haut gradé vous aura donné accès.",
          "succes",
        );
        formSignup.reset();
      } catch (err) {
        afficherMessage(err.message, "erreur");
      } finally {
        btn.disabled = false;
        btn.textContent = "S'inscrire";
      }
    });
  }
}

/* ==== Boot ==== */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    cacherLiensSelonRole();
    const autorise = await protegerPage();
    if (!autorise) return;
    await injecterLienNavbar();
    initPageConnexion();
    window.dispatchEvent(new CustomEvent("sith-auth-pret"));
  } catch (err) {
    console.error("[auth]", err);
  }
});
