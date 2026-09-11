/* ============================================================
   Modale de confirmation (globale)
   ============================================================ */
function modaleConfirmation(message, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modale-overlay";
    overlay.innerHTML = `
      <div class="modale" role="dialog" aria-modal="true">
        <div class="modale-sceau"><span>⚔</span></div>
        <div class="modale-titre">${options.titre || "Confirmation"}</div>
        <div class="modale-texte">${message}</div>
        <div class="modale-actions">
          <button type="button" class="btn discret" data-action="annuler">Annuler</button>
          <button type="button" class="btn danger" data-action="valider">${options.valider || "Confirmer"}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("visible"));

    function fermer(reponse) {
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 250);
      document.removeEventListener("keydown", onKey);
      resolve(reponse);
    }
    function onKey(e) {
      if (e.key === "Escape") fermer(false);
      if (e.key === "Enter" && !e.target.matches("textarea")) fermer(true);
    }
    overlay
      .querySelector('[data-action="annuler"]')
      .addEventListener("click", () => fermer(false));
    overlay
      .querySelector('[data-action="valider"]')
      .addEventListener("click", () => fermer(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) fermer(false);
    });
    document.addEventListener("keydown", onKey);
    setTimeout(
      () => overlay.querySelector('[data-action="valider"]').focus(),
      100,
    );
  });
}

/* ============================================================
   CHAT — Canaux de discussion
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  const listeCanaux = document.getElementById("liste-canaux");
  if (!listeCanaux) return;

  if (!window.SithAuth) {
    await new Promise((r) =>
      window.addEventListener("sith-auth-pret", r, { once: true }),
    );
  }

  const profil = await window.SithAuth.profil();
  if (!profil || !window.SithAuth.estMembre(profil)) return;

  const supabase = await window.SithAuth.supabase();
  const estHG = window.SithAuth.estHautGrade(profil);

  let canalActif = null;
  let subscription = null;
  let listeMembres = [];
  let mentionsParCanal = {};
  let nonLusParCanal = {};
  let autocompleteIndex = -1;
  let autocompleteSuggestions = [];
  let reponseA = null;
  let epinglesOuverts = true;

  const NIVEAU_ROLE = {
    en_attente: 0,
    membre: 1,
    haut_grade: 2,
    administrateur: 3,
    gerant: 4,
  };
  const monNiveau = NIVEAU_ROLE[profil.role] ?? -1;

  function echapper(texte) {
    const div = document.createElement("div");
    div.textContent = texte || "";
    return div.innerHTML;
  }

  function extraireExtrait(texte, max = 100) {
    const t = (texte || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max) + "…" : t;
  }

  function parserMentions(contenu) {
    const escaped = echapper(contenu);
    const pseudos = new Set(listeMembres.map((m) => m.pseudo));
    return escaped.replace(/@([\wÀ-ÿ_-]+)/g, (match, pseudo) => {
      if (!pseudos.has(pseudo)) return match;
      const estMoi = pseudo === profil.pseudo;
      const cls = estMoi ? "mention mention-moi" : "mention";
      return `<span class="${cls}">@${pseudo}</span>`;
    });
  }

  function peutEcrire(canal) {
    if (!canal) return false;
    const min = NIVEAU_ROLE[canal.ecriture_min] ?? 1;
    return monNiveau >= min;
  }

  function libelleMin(min) {
    const L = {
      membre: "Membres",
      haut_grade: "Hauts gradés",
      administrateur: "Administrateurs",
      gerant: "Gérants",
    };
    return L[min] || min;
  }

  function peutSupprimer(m) {
    return estHG || m.auteur_id === profil.id;
  }
  function peutModifier(m) {
    return m.auteur_id === profil.id;
  }
  function peutEpingler() {
    return estHG;
  }

  async function chargerMembres() {
    listeMembres = await window.SithAuth.listerMembresPourMentions();
  }

  async function rechargerMentionsParCanal() {
    mentionsParCanal = await window.SithAuth.compterMentionsParCanal();
  }

  async function chargerCanaux() {
    const { data, error } = await supabase
      .from("canaux")
      .select("*")
      .order("ordre", { ascending: true });
    if (error) {
      console.error("[chat] Erreur canaux:", error);
      return [];
    }
    return data || [];
  }

  function afficherCanaux(canaux) {
    if (canaux.length === 0) {
      listeCanaux.innerHTML =
        '<li class="chat-vide">Aucun canal disponible</li>';
      return;
    }
    listeCanaux.innerHTML = canaux
      .map((c) => {
        const lock =
          c.acces === "haut_grade" ? '<span class="chat-lock">🔒</span>' : "";
        const readOnly = !peutEcrire(c)
          ? '<span class="chat-ro" title="Lecture seule">👁</span>'
          : "";
        const nbMentions = mentionsParCanal[c.id] || 0;
        const nbNonLus = nonLusParCanal[c.id] || 0;
        const estActif = canalActif && canalActif.id === c.id;
        const nonLu = !estActif && nbNonLus > 0;

        let badge = "";
        if (nbMentions > 0) {
          badge = `<span class="chat-canal-badge">${nbMentions}</span>`;
        } else if (nonLu) {
          badge = `<span class="chat-canal-badge chat-canal-badge-nonlu">${nbNonLus > 99 ? "99+" : nbNonLus}</span>`;
        }

        return `
        <li class="chat-canal-item ${nonLu ? "non-lu" : ""}" data-id="${c.id}">
          ${lock}
          <span class="chat-canal-icone">${c.icone || "💬"}</span>
          <span class="chat-canal-nom">${echapper(c.nom)}</span>
          ${badge}
          ${readOnly}
        </li>
      `;
      })
      .join("");

    listeCanaux.querySelectorAll(".chat-canal-item").forEach((item) => {
      item.addEventListener("click", () =>
        ouvrirCanal(item.getAttribute("data-id"), canaux),
      );
    });
  }

  async function ouvrirCanal(id, canaux) {
    const canal = canaux.find((c) => c.id === id);
    if (!canal) return;

    canalActif = canal;
    annulerReponse();

    try {
      await window.SithAuth.marquerMentionsCanalLues(id);
      await window.SithAuth.marquerCanalLu(id);
      delete mentionsParCanal[id];
      delete nonLusParCanal[id];
      const item = listeCanaux.querySelector(
        `.chat-canal-item[data-id="${id}"]`,
      );
      if (item) {
        item.classList.remove("non-lu");
        const b = item.querySelector(".chat-canal-badge");
        if (b) b.remove();
      }
      document.dispatchEvent(new CustomEvent("mentions-changees"));
    } catch (e) {
      /* ignore */
    }

    listeCanaux.querySelectorAll(".chat-canal-item").forEach((el) => {
      el.classList.toggle("actif", el.getAttribute("data-id") === id);
    });

    document.getElementById("canal-nom").textContent =
      `${canal.icone || "💬"} ${canal.nom}`;

    const autorise = peutEcrire(canal);
    const infoEcriture = autorise
      ? ""
      : ` — <span class="chat-desc-ro">🔒 Écriture réservée : ${libelleMin(canal.ecriture_min)}</span>`;
    document.getElementById("canal-desc").innerHTML =
      echapper(canal.description || "") + infoEcriture;

    const ta = document.getElementById("chat-input");
    const btn = document.querySelector('#chat-form button[type="submit"]');

    if (autorise) {
      ta.disabled = false;
      btn.disabled = false;
      ta.placeholder = "Écris ton message… (Entrée = nouvelle ligne)";
    } else {
      ta.disabled = true;
      btn.disabled = true;
      ta.value = "";
      ta.placeholder = `🔒 Écriture réservée : ${libelleMin(canal.ecriture_min)}`;
    }
    autoResize(ta);

    await chargerMessages(id);
    await chargerEpingles(id);

    if (subscription) await supabase.removeChannel(subscription);
    subscription = supabase
      .channel("messages-" + id)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `canal_id=eq.${id}`,
        },
        async (payload) => {
          const newMsg = payload.new;
          if (newMsg.reponse_a_id) {
            const { data: parent } = await supabase
              .from("messages")
              .select("id, contenu, auteur_pseudo")
              .eq("id", newMsg.reponse_a_id)
              .single();
            newMsg.reponse = parent;
          }
          ajouterMessage(newMsg);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `canal_id=eq.${id}`,
        },
        (payload) => {
          majMessageDOM(payload.new);
          majEpinglePourMessage(payload.new);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          if (payload.old?.canal_id && payload.old.canal_id !== canalActif?.id)
            return;
          supprimerMessageDOM(payload.old);
          retirerEpingle(payload.old.id);
        },
      )
      .subscribe();

    // Écoute globale des nouveaux messages pour incrémenter les non-lus
    if (window._subNonLus) await supabase.removeChannel(window._subNonLus);
    window._subNonLus = supabase
      .channel("non-lus")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const m = payload.new;
          if (!m || m.auteur_id === profil.id) return;
          if (canalActif && m.canal_id === canalActif.id) return;
          nonLusParCanal[m.canal_id] = (nonLusParCanal[m.canal_id] || 0) + 1;
          const item = listeCanaux.querySelector(
            `.chat-canal-item[data-id="${m.canal_id}"]`,
          );
          if (!item) return;
          item.classList.add("non-lu");
          let badge = item.querySelector(".chat-canal-badge");
          if (badge && badge.classList.contains("chat-canal-badge-nonlu")) {
            badge.textContent =
              nonLusParCanal[m.canal_id] > 99
                ? "99+"
                : nonLusParCanal[m.canal_id];
          } else if (!badge) {
            const nom = item.querySelector(".chat-canal-nom");
            badge = document.createElement("span");
            badge.className = "chat-canal-badge chat-canal-badge-nonlu";
            badge.textContent =
              nonLusParCanal[m.canal_id] > 99
                ? "99+"
                : nonLusParCanal[m.canal_id];
            nom.after(badge);
          }
        },
      )
      .subscribe();
  }

  async function chargerMessages(canalId) {
    const conteneur = document.getElementById("chat-messages");
    conteneur.innerHTML = '<div class="chat-placeholder">Chargement…</div>';

    const { data, error } = await supabase
      .from("messages")
      .select(
        `
        *,
        reponse:messages!reponse_a_id ( id, contenu, auteur_pseudo )
      `,
      )
      .eq("canal_id", canalId)
      .order("cree_le", { ascending: true })
      .limit(200);

    if (error) {
      const { data: dataSimple, error: errSimple } = await supabase
        .from("messages")
        .select("*")
        .eq("canal_id", canalId)
        .order("cree_le", { ascending: true })
        .limit(200);
      if (errSimple) {
        conteneur.innerHTML =
          '<div class="chat-placeholder">Erreur : ' +
          echapper(errSimple.message) +
          "</div>";
        return;
      }
      conteneur.innerHTML =
        (dataSimple || []).map((m) => htmlMessage(m)).join("") ||
        '<div class="chat-placeholder">Aucun message pour le moment.</div>';
      scrollEnBas();
      return;
    }

    if (!data || data.length === 0) {
      conteneur.innerHTML =
        '<div class="chat-placeholder">Aucun message pour le moment.</div>';
      return;
    }
    conteneur.innerHTML = data.map((m) => htmlMessage(m)).join("");

    const params = new URLSearchParams(location.search);
    const cible = params.get("message");
    if (cible) {
      const el = conteneur.querySelector(`.chat-message[data-id="${cible}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("highlight");
        setTimeout(() => el.classList.remove("highlight"), 2500);
      } else {
        scrollEnBas();
      }
    } else {
      scrollEnBas();
    }
  }

  /* === Épingles === */
  async function chargerEpingles(canalId) {
    const conteneurListe = document.getElementById("chat-epingles-liste");
    const conteneurBloc = document.getElementById("chat-epingles");
    const compteur = document.getElementById("chat-epingles-count");

    const { data, error } = await supabase
      .from("messages")
      .select("id, contenu, auteur_pseudo, epingle_le")
      .eq("canal_id", canalId)
      .eq("epingle", true)
      .order("epingle_le", { ascending: false });

    if (error || !data || data.length === 0) {
      conteneurBloc.hidden = true;
      conteneurListe.innerHTML = "";
      return;
    }

    conteneurBloc.hidden = false;
    compteur.textContent = data.length;
    conteneurListe.innerHTML = data
      .map(
        (m) => `
      <div class="chat-epingle-item" data-scroll-to="${m.id}" data-id="${m.id}">
        <div class="chat-epingle-item-entete">
          <span class="chat-epingle-item-auteur">${echapper(m.auteur_pseudo)}</span>
          ${peutEpingler() ? `<button type="button" class="chat-epingle-retirer" data-action="unpin" data-id="${m.id}" title="Désépingler">✕</button>` : ""}
        </div>
        <div class="chat-epingle-item-extrait">${echapper(extraireExtrait(m.contenu, 150))}</div>
      </div>
    `,
      )
      .join("");
  }

  function majEpinglePourMessage(m) {
    if (!canalActif || m.canal_id !== canalActif.id) return;
    chargerEpingles(canalActif.id);
  }

  function retirerEpingle(id) {
    const item = document.querySelector(`.chat-epingle-item[data-id="${id}"]`);
    if (item) {
      item.remove();
      const conteneur = document.getElementById("chat-epingles-liste");
      const bloc = document.getElementById("chat-epingles");
      const compteur = document.getElementById("chat-epingles-count");
      const reste = conteneur.querySelectorAll(".chat-epingle-item").length;
      if (reste === 0) bloc.hidden = true;
      else compteur.textContent = reste;
    }
  }

  async function toggleEpingle(id) {
    try {
      const { error } = await supabase.rpc("toggle_epingle_message", {
        p_message_id: id,
      });
      if (error) throw error;
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  }

  document
    .getElementById("chat-epingles-toggle")
    .addEventListener("click", () => {
      epinglesOuverts = !epinglesOuverts;
      const liste = document.getElementById("chat-epingles-liste");
      const chevron = document.getElementById("chat-epingles-chevron");
      liste.style.display = epinglesOuverts ? "" : "none";
      chevron.textContent = epinglesOuverts ? "▾" : "▸";
    });

  function htmlMessage(m) {
    const estMoi = m.auteur_id === profil.id;
    const date = new Date(m.cree_le);
    const heure = date.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const jour = date.toLocaleDateString("fr-FR");
    const modifie = m.modifie_le
      ? '<span class="chat-message-modifie">(modifié)</span>'
      : "";
    const marqueurEpingle = m.epingle
      ? '<span class="chat-message-epingle-marqueur" title="Message épinglé">📌</span>'
      : "";

    let actions = '<div class="chat-message-actions">';
    actions += `<button type="button" class="chat-btn-reply" data-action="reply" data-id="${m.id}" title="Répondre">↩</button>`;
    if (peutEpingler()) {
      const label = m.epingle ? "Désépingler" : "Épingler";
      actions += `<button type="button" class="chat-btn-pin ${m.epingle ? "actif" : ""}" data-action="pin" data-id="${m.id}" title="${label}">📌</button>`;
    }
    if (peutModifier(m)) {
      actions += `<button type="button" class="chat-btn-edit" data-action="edit" data-id="${m.id}" title="Modifier">✎</button>`;
    }
    if (peutSupprimer(m)) {
      actions += `<button type="button" class="chat-btn-delete" data-action="delete" data-id="${m.id}" title="Supprimer">×</button>`;
    }
    actions += "</div>";

    let citation = "";
    if (m.reponse_a_id) {
      const parent = m.reponse;
      if (parent) {
        citation = `
          <div class="chat-message-reponse" data-scroll-to="${parent.id}">
            <span class="chat-reponse-auteur">↩ ${echapper(parent.auteur_pseudo)}</span>
            <span class="chat-reponse-extrait">${echapper(extraireExtrait(parent.contenu, 120))}</span>
          </div>
        `;
      } else {
        citation = `
          <div class="chat-message-reponse chat-message-reponse-absent">
            <span class="chat-reponse-auteur">↩ message supprimé ou antérieur</span>
          </div>
        `;
      }
    }

    return `
      <div class="chat-message ${estMoi ? "moi" : ""} ${m.epingle ? "est-epingle" : ""}" data-id="${m.id}">
        ${actions}
        ${citation}
        <div class="chat-message-entete">
          <span class="chat-message-pseudo">${echapper(m.auteur_pseudo)}</span>
          <span class="chat-message-heure" title="${jour}">${heure}</span>
          ${modifie}
          ${marqueurEpingle}
        </div>
        <div class="chat-message-contenu">${parserMentions(m.contenu)}</div>
      </div>
    `;
  }

  function ajouterMessage(m) {
    if (!canalActif || m.canal_id !== canalActif.id) return;
    const conteneur = document.getElementById("chat-messages");
    const placeholder = conteneur.querySelector(".chat-placeholder");
    if (placeholder) placeholder.remove();
    if (conteneur.querySelector(`.chat-message[data-id="${m.id}"]`)) return;
    conteneur.insertAdjacentHTML("beforeend", htmlMessage(m));
    scrollEnBas();
  }

  function supprimerMessageDOM(oldRow) {
    if (!oldRow?.id) return;
    const el = document.querySelector(`.chat-message[data-id="${oldRow.id}"]`);
    if (!el) return;
    el.remove();
    const conteneur = document.getElementById("chat-messages");
    if (conteneur && conteneur.querySelectorAll(".chat-message").length === 0) {
      conteneur.innerHTML =
        '<div class="chat-placeholder">Aucun message pour le moment.</div>';
    }
  }

  function majMessageDOM(newRow) {
    if (!newRow?.id) return;
    const el = document.querySelector(`.chat-message[data-id="${newRow.id}"]`);
    if (!el) return;
    if (el.classList.contains("en-edition")) return;

    const contenuEl = el.querySelector(".chat-message-contenu");
    if (contenuEl) contenuEl.innerHTML = parserMentions(newRow.contenu);

    const entete = el.querySelector(".chat-message-entete");
    if (newRow.modifie_le && !entete.querySelector(".chat-message-modifie")) {
      const span = document.createElement("span");
      span.className = "chat-message-modifie";
      span.textContent = "(modifié)";
      entete.appendChild(span);
    }

    el.classList.toggle("est-epingle", !!newRow.epingle);

    const boutonPin = el.querySelector(".chat-btn-pin");
    if (boutonPin) {
      boutonPin.classList.toggle("actif", !!newRow.epingle);
      boutonPin.title = newRow.epingle ? "Désépingler" : "Épingler";
    }

    let marqueur = entete.querySelector(".chat-message-epingle-marqueur");
    if (newRow.epingle && !marqueur) {
      marqueur = document.createElement("span");
      marqueur.className = "chat-message-epingle-marqueur";
      marqueur.title = "Message épinglé";
      marqueur.textContent = "📌";
      entete.appendChild(marqueur);
    } else if (!newRow.epingle && marqueur) {
      marqueur.remove();
    }
  }

  function scrollEnBas() {
    const c = document.getElementById("chat-messages");
    if (c) c.scrollTop = c.scrollHeight;
  }

  function scrollVersMessage(id) {
    const el = document.querySelector(`.chat-message[data-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlight");
    setTimeout(() => el.classList.remove("highlight"), 2500);
  }

  function activerReponse(id) {
    const el = document.querySelector(`.chat-message[data-id="${id}"]`);
    if (!el) return;
    const pseudo = el.querySelector(".chat-message-pseudo")?.textContent || "?";
    const contenu =
      el.querySelector(".chat-message-contenu")?.textContent || "";

    reponseA = { id, pseudo, contenu };

    document.getElementById("chat-reply-preview-auteur").textContent =
      `↩ Réponse à ${pseudo}`;
    document.getElementById("chat-reply-preview-extrait").textContent =
      extraireExtrait(contenu, 120);
    document.getElementById("chat-reply-preview").hidden = false;

    const ta = document.getElementById("chat-input");
    if (!ta.disabled) ta.focus();
  }

  function annulerReponse() {
    reponseA = null;
    const preview = document.getElementById("chat-reply-preview");
    if (preview) preview.hidden = true;
  }

  document
    .getElementById("chat-reply-close")
    .addEventListener("click", annulerReponse);

  async function supprimerMessage(id) {
    const ok = await modaleConfirmation(
      "Ce message sera définitivement supprimé pour tous les membres.",
      { titre: "Supprimer ce message ?", valider: "Supprimer" },
    );
    if (!ok) return;
    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) {
      alert("Erreur : " + error.message);
      return;
    }
    supprimerMessageDOM({ id });
  }

  function activerEdition(id) {
    const el = document.querySelector(`.chat-message[data-id="${id}"]`);
    if (!el || el.classList.contains("en-edition")) return;
    const contenuEl = el.querySelector(".chat-message-contenu");
    const contenuOriginal = contenuEl.textContent;

    el.classList.add("en-edition");
    contenuEl.innerHTML = `
      <textarea class="chat-edit-input" maxlength="2000"></textarea>
      <div class="chat-edit-actions">
        <button type="button" class="chat-edit-save">Enregistrer</button>
        <button type="button" class="chat-edit-cancel">Annuler</button>
      </div>
    `;
    const ta = contenuEl.querySelector("textarea");
    ta.value = contenuOriginal;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    contenuEl
      .querySelector(".chat-edit-cancel")
      .addEventListener("click", () => {
        el.classList.remove("en-edition");
        contenuEl.textContent = contenuOriginal;
      });

    contenuEl
      .querySelector(".chat-edit-save")
      .addEventListener("click", async () => {
        const nouveau = ta.value.trim();
        if (!nouveau) return;
        if (nouveau === contenuOriginal) {
          el.classList.remove("en-edition");
          contenuEl.textContent = contenuOriginal;
          return;
        }
        const { error } = await supabase
          .from("messages")
          .update({ contenu: nouveau })
          .eq("id", id);
        if (error) {
          alert("Erreur : " + error.message);
          return;
        }
        el.classList.remove("en-edition");
        contenuEl.innerHTML = parserMentions(nouveau);
        const entete = el.querySelector(".chat-message-entete");
        if (!entete.querySelector(".chat-message-modifie")) {
          const span = document.createElement("span");
          span.className = "chat-message-modifie";
          span.textContent = "(modifié)";
          entete.appendChild(span);
        }
      });
  }

  document
    .getElementById("chat-messages")
    .addEventListener("click", async (e) => {
      const citation = e.target.closest(".chat-message-reponse");
      if (
        citation &&
        !citation.classList.contains("chat-message-reponse-absent")
      ) {
        const cible = citation.getAttribute("data-scroll-to");
        if (cible) {
          scrollVersMessage(cible);
          return;
        }
      }

      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "delete") await supprimerMessage(id);
      else if (action === "edit") activerEdition(id);
      else if (action === "reply") activerReponse(id);
      else if (action === "pin") await toggleEpingle(id);
    });

  document
    .getElementById("chat-epingles-liste")
    .addEventListener("click", async (e) => {
      const btnUnpin = e.target.closest('[data-action="unpin"]');
      if (btnUnpin) {
        e.stopPropagation();
        await toggleEpingle(btnUnpin.getAttribute("data-id"));
        return;
      }
      const item = e.target.closest(".chat-epingle-item");
      if (item) {
        const id = item.getAttribute("data-scroll-to");
        scrollVersMessage(id);
      }
    });

  function autoResize(ta) {
    if (!ta) return;
    ta.style.height = "auto";
    const maxH = 120;
    const h = Math.min(ta.scrollHeight, maxH);
    ta.style.height = h + "px";
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
  }

  function fermerAutocomplete() {
    autocompleteIndex = -1;
    autocompleteSuggestions = [];
    const el = document.getElementById("chat-autocomplete");
    if (el) el.remove();
  }

  function afficherAutocomplete(suggestions) {
    fermerAutocomplete();
    autocompleteSuggestions = suggestions;
    autocompleteIndex = 0;

    const conteneur = document.querySelector(".chat-principal");
    const div = document.createElement("div");
    div.id = "chat-autocomplete";
    div.className = "chat-autocomplete";
    div.innerHTML = suggestions
      .map(
        (s, i) => `
      <div class="chat-autocomplete-item ${i === 0 ? "actif" : ""}" data-index="${i}">
        <span class="chat-autocomplete-pseudo">@${echapper(s.pseudo)}</span>
        <span class="chat-autocomplete-role">${s.role}</span>
      </div>
    `,
      )
      .join("");
    conteneur.appendChild(div);

    div.querySelectorAll(".chat-autocomplete-item").forEach((item) => {
      item.addEventListener("click", () => {
        const idx = parseInt(item.getAttribute("data-index"), 10);
        insererMention(suggestions[idx].pseudo);
      });
    });
  }

  function majAutocompleteActif() {
    const div = document.getElementById("chat-autocomplete");
    if (!div) return;
    div.querySelectorAll(".chat-autocomplete-item").forEach((el, i) => {
      el.classList.toggle("actif", i === autocompleteIndex);
    });
  }

  function detecterAutocomplete() {
    const ta = document.getElementById("chat-input");
    if (!ta || ta.disabled) {
      fermerAutocomplete();
      return;
    }
    const val = ta.value;
    const pos = ta.selectionStart;
    const avant = val.slice(0, pos);
    const match = avant.match(/@([\wÀ-ÿ_-]*)$/);
    if (!match) {
      fermerAutocomplete();
      return;
    }
    const query = match[1].toLowerCase();
    const suggestions = listeMembres
      .filter((m) => m.id !== profil.id)
      .filter((m) => m.pseudo.toLowerCase().startsWith(query))
      .slice(0, 10);
    if (suggestions.length === 0) {
      fermerAutocomplete();
      return;
    }
    afficherAutocomplete(suggestions);
  }

  function insererMention(pseudo) {
    const ta = document.getElementById("chat-input");
    if (!ta) return;
    const val = ta.value;
    const pos = ta.selectionStart;
    const avant = val.slice(0, pos);
    const apres = val.slice(pos);
    const nouveau = avant.replace(/@([\wÀ-ÿ_-]*)$/, "@" + pseudo + " ") + apres;
    ta.value = nouveau;
    const nouvellePos = avant.replace(
      /@([\wÀ-ÿ_-]*)$/,
      "@" + pseudo + " ",
    ).length;
    ta.setSelectionRange(nouvellePos, nouvellePos);
    ta.focus();
    autoResize(ta);
    fermerAutocomplete();
  }

  const textarea = document.getElementById("chat-input");
  textarea.addEventListener("input", () => {
    autoResize(textarea);
    detecterAutocomplete();
  });
  textarea.addEventListener("click", detecterAutocomplete);
  textarea.addEventListener("keydown", (e) => {
    const div = document.getElementById("chat-autocomplete");
    if (div) {
      if (e.key === "Tab") {
        e.preventDefault();
        if (autocompleteSuggestions[autocompleteIndex]) {
          insererMention(autocompleteSuggestions[autocompleteIndex].pseudo);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        autocompleteIndex = Math.min(
          autocompleteIndex + 1,
          autocompleteSuggestions.length - 1,
        );
        majAutocompleteActif();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
        majAutocompleteActif();
        return;
      }
      if (e.key === "Escape") {
        fermerAutocomplete();
        return;
      }
    }
  });

  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canalActif || !peutEcrire(canalActif)) return;

    const contenu = textarea.value.trim();
    if (!contenu) return;

    const payload = {
      canal_id: canalActif.id,
      auteur_id: profil.id,
      auteur_pseudo: profil.pseudo,
      contenu: contenu,
    };
    if (reponseA) payload.reponse_a_id = reponseA.id;

    textarea.disabled = true;
    const { data, error } = await supabase
      .from("messages")
      .insert(payload)
      .select()
      .single();
    textarea.disabled = false;

    if (error) {
      alert("Erreur : " + error.message);
      return;
    }

    if (data && reponseA) {
      data.reponse = {
        id: reponseA.id,
        contenu: reponseA.contenu,
        auteur_pseudo: reponseA.pseudo,
      };
    }

    if (data && data.canal_id === canalActif.id) ajouterMessage(data);

    textarea.value = "";
    autoResize(textarea);
    annulerReponse();
    textarea.focus();
  });

  await chargerMembres();
  await rechargerMentionsParCanal();
  nonLusParCanal = await window.SithAuth.compterNonLus();
  const canaux = await chargerCanaux();
  afficherCanaux(canaux);

  const params = new URLSearchParams(location.search);
  const canalParam = params.get("canal");
  const canalCible = canalParam
    ? canaux.find((c) => c.id === canalParam)
    : canaux[0];
  if (canalCible) ouvrirCanal(canalCible.id, canaux);

  document.addEventListener("mentions-changees", async () => {
    await rechargerMentionsParCanal();
    const canauxMaj = await chargerCanaux();
    afficherCanaux(canauxMaj);
    if (canalActif) {
      const item = listeCanaux.querySelector(
        `.chat-canal-item[data-id="${canalActif.id}"]`,
      );
      if (item) item.classList.add("actif");
    }
  });
});
