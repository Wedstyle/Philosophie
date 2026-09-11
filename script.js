document.addEventListener("DOMContentLoaded", () => {
  /* === Recherche interne === */
  const recherche = document.getElementById("recherche");
  const compteur = document.getElementById("recherche-compteur");

  if (recherche) {
    const cibles = document.querySelectorAll(".bloc, .code-sith .ligne");
    recherche.addEventListener("input", () => {
      const q = recherche.value.trim().toLowerCase();
      if (q === "") {
        cibles.forEach((el) => (el.style.display = ""));
        if (compteur) compteur.textContent = "";
        return;
      }
      let visibles = 0;
      cibles.forEach((el) => {
        const match = el.textContent.toLowerCase().includes(q);
        el.style.display = match ? "" : "none";
        if (match) visibles++;
      });
      if (compteur) {
        compteur.textContent =
          visibles === 0
            ? "Aucun résultat"
            : `${visibles} résultat${visibles > 1 ? "s" : ""}`;
      }
    });
  }

  /* === Sommaire latéral actif au scroll === */
  const liensSommaire = document.querySelectorAll(".sommaire-lateral a");
  if (liensSommaire.length > 0 && "IntersectionObserver" in window) {
    const cibles = [...liensSommaire]
      .map((a) => {
        const href = a.getAttribute("href");
        return href && href.startsWith("#")
          ? document.querySelector(href)
          : null;
      })
      .filter(Boolean);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            liensSommaire.forEach((l) => l.classList.remove("actif"));
            const lien = [...liensSommaire].find(
              (l) => l.getAttribute("href") === "#" + entry.target.id,
            );
            if (lien) lien.classList.add("actif");
          }
        });
      },
      { rootMargin: "-100px 0px -70% 0px", threshold: 0 },
    );

    cibles.forEach((c) => observer.observe(c));
  }

  /* === Utilitaires partagés === */
  function formaterDate(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function echapper(texte) {
    const div = document.createElement("div");
    div.textContent = texte || "";
    return div.innerHTML;
  }

  const SYMBOLES_NIVEAU = { 1: "I", 2: "II", 3: "III", 4: "IV" };

  function genererCarteHTML(data, options = {}) {
    const suppr = options.supprimable
      ? `<button class="btn-suppr" data-id="${options.id}" title="Supprimer cette sanction" aria-label="Supprimer cette sanction">×</button>`
      : "";
    const typeComplet = data.precision
      ? `${data.type_sanction} — ${data.precision}`
      : data.type_sanction;
    const numNiveau = SYMBOLES_NIVEAU[data.niveau] || data.niveau;
    const dateAff = formaterDate(data.date_sanction);

    return `
      ${suppr}
      <div class="entete">
        <span class="sceau">⚔</span>
        <div class="titre-bloc">
          <div class="label">Sanction émise le</div>
          <div class="date">${dateAff}</div>
        </div>
        <span class="badge-niveau niveau-${data.niveau}">Niveau ${numNiveau}</span>
      </div>
      <div class="ligne-info"><strong>Identité du membre ayant appliqué la sanction :</strong> <span class="valeur">${echapper(data.nom_emetteur) || "—"}</span></div>
      <div class="ligne-info"><strong>Identité de l'individu sanctionné :</strong> <span class="valeur">${echapper(data.nom_cible) || "—"}</span></div>
      <div class="ligne-info"><strong>Sanction émise :</strong> <span class="valeur">${echapper(typeComplet) || "—"}</span></div>
      <div class="ligne-info"><strong>Motif :</strong> <span class="valeur">${echapper(data.motif) || "—"}</span></div>
      <div class="ligne-info"><strong>Preuves préalables :</strong> <span class="valeur">${echapper(data.preuves) || "—"}</span></div>
    `;
  }

  /* === Fonctions Supabase pour les sanctions === */
  async function chargerSanctions() {
    const c = await window.SithAuth.supabase();
    const { data, error } = await c
      .from("sanctions")
      .select("*")
      .order("cree_le", { ascending: false });
    if (error) {
      console.error("[sanctions] Erreur chargement:", error);
      return [];
    }
    return data || [];
  }

  async function insererSanction(s) {
    const session = await window.SithAuth.session();
    if (!session) throw new Error("Vous devez être connecté.");
    const c = await window.SithAuth.supabase();
    const { data, error } = await c
      .from("sanctions")
      .insert({
        date_sanction: s.date,
        niveau: parseInt(s.niveau, 10),
        nom_emetteur: s.nomEmetteur,
        nom_cible: s.nomCible,
        type_sanction: s.typeSanction,
        precision: s.precision || null,
        motif: s.motif,
        preuves: s.preuves || null,
        emetteur_id: session.user.id,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function supprimerSanction(id) {
    const c = await window.SithAuth.supabase();
    const { error } = await c.from("sanctions").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  /* === Page Nouvelle Sanction (formulaire) === */
  const formSanction = document.getElementById("form-sanction");
  if (formSanction) {
    const champs = {
      date: document.getElementById("s-date"),
      nomEmetteur: document.getElementById("s-nom-emetteur"),
      nomCible: document.getElementById("s-nom-cible"),
      typeSanction: document.getElementById("s-type"),
      precision: document.getElementById("s-precision"),
      niveau: document.getElementById("s-niveau"),
      motif: document.getElementById("s-motif"),
      preuves: document.getElementById("s-preuves"),
    };

    if (champs.date && !champs.date.value) {
      champs.date.value = new Date().toISOString().slice(0, 10);
    }

    const preview = document.getElementById("preview-sanction");
    const bandeau = document.getElementById("bandeau-registre");
    const bandeauTexte = document.getElementById("bandeau-texte");

    function lireFormulaire() {
      return {
        date: champs.date.value,
        nomEmetteur: champs.nomEmetteur.value.trim(),
        nomCible: champs.nomCible.value.trim(),
        typeSanction: champs.typeSanction.value,
        precision: champs.precision.value.trim(),
        niveau: champs.niveau.value,
        motif: champs.motif.value.trim(),
        preuves: champs.preuves.value.trim(),
      };
    }

    function mettreAJourApercu() {
      const d = lireFormulaire();
      preview.setAttribute("data-niveau", d.niveau);
      preview.innerHTML = genererCarteHTML({
        date_sanction: d.date,
        niveau: d.niveau,
        nom_emetteur: d.nomEmetteur,
        nom_cible: d.nomCible,
        type_sanction: d.typeSanction,
        precision: d.precision,
        motif: d.motif,
        preuves: d.preuves,
      });
    }

    Object.values(champs).forEach((c) => {
      if (!c) return;
      c.addEventListener("input", mettreAJourApercu);
      c.addEventListener("change", mettreAJourApercu);
    });
    mettreAJourApercu();

    async function mettreAJourBandeau() {
      if (!bandeau || !bandeauTexte) return;
      const liste = await chargerSanctions();
      const n = liste.length;
      if (n === 0) {
        bandeau.hidden = true;
        return;
      }
      bandeau.hidden = false;
      bandeauTexte.innerHTML = `<strong>${n}</strong> sanction${n > 1 ? "s" : ""} enregistrée${n > 1 ? "s" : ""} dans le registre.`;
    }
    mettreAJourBandeau();

    /* Enregistrer */
    document
      .getElementById("btn-sauver")
      .addEventListener("click", async () => {
        const data = lireFormulaire();
        if (!data.nomEmetteur || !data.nomCible || !data.motif) {
          alert(
            "Merci de renseigner au minimum : le nom de l'émetteur, le nom du sanctionné et le motif.",
          );
          return;
        }
        const btn = document.getElementById("btn-sauver");
        const old = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Enregistrement…";
        try {
          await insererSanction(data);
          btn.textContent = "✓ Enregistré";
          await mettreAJourBandeau();
        } catch (err) {
          alert("Erreur : " + err.message);
          btn.textContent = old;
        }
        setTimeout(() => {
          btn.textContent = old;
          btn.disabled = false;
        }, 1500);
      });

    /* Copier */
    document.getElementById("btn-copier").addEventListener("click", () => {
      const d = lireFormulaire();
      const typeComplet = d.precision
        ? `${d.typeSanction} — ${d.precision}`
        : d.typeSanction;
      const txt = `SANCTION ÉMISE LE : ${formaterDate(d.date)}

Identité du membre ayant appliqué la sanction : ${d.nomEmetteur}

Identité de l'individu sanctionné : ${d.nomCible}

Sanction émise : ${typeComplet} (Niveau ${d.niveau})

Motif : ${d.motif}

Preuves préalables : ${d.preuves}`;

      navigator.clipboard
        .writeText(txt)
        .then(() => {
          const btn = document.getElementById("btn-copier");
          const old = btn.textContent;
          btn.textContent = "✓ Copié";
          setTimeout(() => {
            btn.textContent = old;
          }, 1500);
        })
        .catch(() =>
          alert("Copie impossible, sélectionne le texte à la main."),
        );
    });

    /* Réinitialiser */
    document.getElementById("btn-reset").addEventListener("click", async () => {
      const ok = await modaleConfirmation(
        "Tous les champs du formulaire seront vidés. Continuer ?",
        { titre: "Réinitialiser ?", valider: "Réinitialiser" },
      );
      if (!ok) return;
      formSanction.reset();
      champs.date.value = new Date().toISOString().slice(0, 10);
      mettreAJourApercu();
    });
  }

  /* === Page Registre Local (liste) === */
  const conteneurPage = document.getElementById("liste-sanctions-page");
  if (conteneurPage) {
    async function afficherListePage() {
      conteneurPage.innerHTML =
        '<p style="color:#666;font-style:italic;text-align:center;margin:2rem 0;">Chargement…</p>';

      const profil = await window.SithAuth.profil();
      const peutSupprimer = window.SithAuth.estHautGrade(profil);

      const liste = await chargerSanctions();
      if (liste.length === 0) {
        conteneurPage.innerHTML =
          '<p style="color:#666;font-style:italic;text-align:center;margin:2rem 0;">Aucune sanction enregistrée pour le moment.</p>';
        return;
      }

      conteneurPage.innerHTML = liste
        .map(
          (s) =>
            `<div class="carte-sanction" data-niveau="${s.niveau}">${genererCarteHTML(s, { supprimable: peutSupprimer, id: s.id })}</div>`,
        )
        .join("");

      conteneurPage.querySelectorAll(".btn-suppr").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const ok = await modaleConfirmation(
            "Cette action est irréversible. La sanction sera définitivement retirée du registre.",
            { titre: "Supprimer la sanction ?", valider: "Supprimer" },
          );
          if (!ok) return;
          try {
            await supprimerSanction(btn.getAttribute("data-id"));
            afficherListePage();
          } catch (err) {
            alert("Erreur : " + err.message);
          }
        });
      });
    }
    afficherListePage();
  }

  /* === Modale de confirmation personnalisée === */
  function modaleConfirmation(message, options = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modale-overlay";
      overlay.innerHTML = `
        <div class="modale" role="dialog" aria-modal="true" aria-labelledby="modale-titre">
          <div class="modale-sceau"><span>⚔</span></div>
          <div class="modale-titre" id="modale-titre">${options.titre || "Confirmation"}</div>
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
        if (e.key === "Enter") fermer(true);
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
});
