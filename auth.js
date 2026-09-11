/* ============================================================
   AUTH — Supabase + navigation + protection des pages
   ============================================================ */

const SUPABASE_URL = "https://idizdchswmvijfoofuiy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkaXpkY2hzd212aWpmb29mdWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzYyMTEsImV4cCI6MjEwNDcxMjIxMX0.TupNcgTT5NQCAq3JHJ9xYvmfQAjn5smNeQNz8ZsIAmM";

/* Chargement dynamique du SDK Supabase */
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

/* Client Supabase (initialisé à la demande) */
let _client = null;
async function client() {
  if (_client) return _client;
  const sdk = await chargerSupabase();
  _client = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

/* Transforme un pseudo en email interne */
function pseudoVersEmail(pseudo) {
  const clean = pseudo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]/g, "");
  return `${clean}@membres.codex-sith.fr`;
}

/* ==== API exposée globalement ==== */
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
    if (!s) {
      console.log("[profil] Pas de session");
      return null;
    }
    const c = await client();
    const { data, error } = await c
      .from("profils")
      .select("*")
      .eq("id", s.user.id)
      .single();
    if (error) {
      console.error("[profil] Erreur requête:", error);
      return null;
    }
    console.log("[profil] Chargé avec succès :", data);
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
      if (/already registered/i.test(error.message)) {
        throw new Error("Ce pseudo est déjà utilisé.");
      }
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
      if (/invalid login/i.test(error.message)) {
        throw new Error("Pseudo ou mot de passe incorrect.");
      }
      throw new Error(error.message);
    }
    return data;
  },

  async deconnexion() {
    const c = await client();
    await c.auth.signOut();
    window.location.href = "index.html";
  },

  /* Raccourcis de rôle */
  estMembre(profil) {
    return profil && (profil.role === "membre" || profil.role === "haut_grade");
  },
  estHautGrade(profil) {
    return profil && profil.role === "haut_grade";
  },
};

/* ==== Cacher / montrer les liens réservés aux membres ==== */
function cacherLiensMembres() {
  const selecteurs = ['a[href="nouvelle-sanction.html"]'];
  selecteurs.forEach((sel) => {
    document.querySelectorAll("nav.principale " + sel).forEach((a) => {
      const li = a.closest("li");
      if (li) li.classList.add("lien-membre-cache");
    });
  });
}

function revelerLiensMembres() {
  document
    .querySelectorAll("nav.principale .lien-membre-cache")
    .forEach((li) => {
      li.classList.remove("lien-membre-cache");
    });
}

/* ==== Injection du lien dans la navbar ==== */
async function injecterLienNavbar() {
  const navUl = document.querySelector("nav.principale ul");
  if (!navUl) return;

  const li = document.createElement("li");
  li.className = "nav-auth-slot";
  navUl.appendChild(li);

  const s = await window.SithAuth.session();
  console.log("[navbar] Session active ?", !!s);
  const profil = s ? await window.SithAuth.profil() : null;
  console.log("[navbar] Profil reçu :", profil);
  console.log("[navbar] Est membre ?", window.SithAuth.estMembre(profil));

  if (profil) {
    li.classList.add("nav-auth-connecte");
    li.innerHTML = `
      <a href="registre-local.html" class="nav-auth">⚔ ${profil.pseudo}</a>
      <button type="button" class="nav-logout" title="Déconnexion" aria-label="Déconnexion">⏻</button>
    `;
    li.querySelector(".nav-logout").addEventListener("click", () =>
      window.SithAuth.deconnexion(),
    );

    if (window.SithAuth.estMembre(profil)) {
      revelerLiensMembres();
    }
  } else {
    li.innerHTML = `<a href="connexion.html" class="nav-auth">🔒 Membres</a>`;
  }
}

/* ==== Protection des pages ==== */
async function protegerPage() {
  const body = document.body;
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
    cacherLiensMembres();

    const autorise = await protegerPage();
    if (!autorise) return;

    await injecterLienNavbar();
    initPageConnexion();

    window.dispatchEvent(new CustomEvent("sith-auth-pret"));
  } catch (err) {
    console.error("[auth]", err);
  }
});
