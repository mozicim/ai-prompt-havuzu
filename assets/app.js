/**
 * AI Prompt Havuzu — client app
 * Loads data/prompts.json snapshot; can live-refresh from sources.json
 */
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const state = {
    prompts: [],
    sources: null,
    loadedFrom: "snapshot",
    sourceStatus: {},
    filter: {
      q: "",
      category: "all",
      tool: "all",
      source: "all",
      tag: "all",
    },
  };

  const els = {
    search: $("#search"),
    grid: $("#grid"),
    statusText: $("#status-text"),
    sourceBadges: $("#source-badges"),
    countPill: $("#count-pill"),
    resultsCount: $("#results-count"),
    catChips: $("#cat-chips"),
    toolChips: $("#tool-chips"),
    sourceChips: $("#source-chips"),
    tagChips: $("#tag-chips"),
    btnRefresh: $("#btn-refresh"),
    btnFilters: $("#btn-filters"),
    advancedFilters: $("#advanced-filters"),
    modal: $("#modal-backdrop"),
    modalTitle: $("#modal-title"),
    modalMeta: $("#modal-meta"),
    modalImageWrap: $("#modal-image-wrap"),
    modalImage: $("#modal-image"),
    modalPrompt: $("#modal-prompt"),
    modalNeg: $("#modal-neg"),
    modalCopy: $("#modal-copy"),
    modalClose: $("#modal-close"),
    modalOpenSource: $("#modal-open-source"),
    footerSources: $("#footer-sources"),
  };

  let activePrompt = null;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function truncate(s, n = 220) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  }

  async function loadSnapshot() {
    els.grid.innerHTML = `<div class="loading"><div class="spinner"></div>Snapshot yükleniyor…</div>`;
    const res = await fetch("data/prompts.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`prompts.json: HTTP ${res.status}`);
    const data = await res.json();
    state.prompts = data.prompts || [];
    state.loadedFrom = "snapshot";
    state.sourceStatus = {};
    if (data.counts) {
      for (const [id, n] of Object.entries(data.counts)) {
        state.sourceStatus[id] = { ok: true, count: n };
      }
    }
    if (Array.isArray(data.errors)) {
      for (const e of data.errors) {
        state.sourceStatus[e.id] = { ok: false, error: e.error, count: 0 };
      }
    }
    return data;
  }

  async function loadSourcesRegistry() {
    if (state.sources) return state.sources;
    const res = await fetch("data/sources.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`sources.json: HTTP ${res.status}`);
    state.sources = await res.json();
    return state.sources;
  }

  function detectLang(text) {
    if (!text) return "en";
    const hasTr = /[ğüşıöçĞÜŞİÖÇ]/.test(text);
    const hasZh = /[\u4e00-\u9fff]/.test(text);
    if (hasTr && /[a-zA-Z]{4,}/.test(text)) return "bilingual";
    if (hasZh && /[a-zA-Z]{8,}/.test(text)) return "bilingual";
    if (hasTr) return "tr";
    if (hasZh) return "zh";
    return "en";
  }

  function titleFromPrompt(prompt, fallback = "Prompt") {
    const line = String(prompt).split(/\n/).map((l) => l.trim()).find(Boolean) || fallback;
    return line.replace(/^[#*\-\s]+/, "").slice(0, 80);
  }

  function sourceMeta(src, itemUrl) {
    return {
      id: src.id,
      name: src.name,
      repo: src.repo,
      url: src.url,
      itemUrl: itemUrl || src.url,
    };
  }

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    for (const t of arr || []) {
      const s = String(t || "").trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  const PV_CDN = "https://cdn.jsdelivr.net/gh/coldxiangyu163/prompt-vault@main/";

  function resolvePromptVaultImage(item) {
    const imgs = item?.images;
    if (!Array.isArray(imgs) || !imgs.length) return undefined;
    const raw = String(imgs[0] || "").trim();
    if (!raw) return undefined;
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = raw.replace(/^\.\//, "");
    return PV_CDN + path;
  }

  function adaptPromptVault(raw, src) {
    return (Array.isArray(raw) ? raw : [])
      .filter((i) => i?.prompt)
      .map((item) => {
        const image = resolvePromptVaultImage(item);
        const entry = {
          id: `pv-${item.id}`,
          title: titleFromPrompt(item.prompt, item.id),
          prompt: String(item.prompt),
          negative: "",
          category: "image",
          tools: item.tool ? [String(item.tool)] : [],
          tags: uniq([...(item.tags || []), item.style].filter(Boolean)),
          language: detectLang(item.prompt),
          source: sourceMeta(src, item.source_url || src.url),
          author: item.author || "",
        };
        if (image) entry.image = image;
        return entry;
      });
  }

  function pickHfText(p) {
    if (!p) return "";
    if (typeof p === "string") return p;
    if (p.text) {
      if (typeof p.text === "string") return p.text;
      return p.text.en || p.text.zh || "";
    }
    return p.en || p.zh || "";
  }

  function adaptHongforge(raw, src) {
    const out = [];
    for (const c of raw.cases || []) {
      const prompt = pickHfText(c.prompt);
      if (!prompt || prompt.length < 20) continue;
      const title =
        (typeof c.title === "string" ? c.title : c.title?.en || c.title?.zh) || c.id;
      out.push({
        id: `hf-case-${c.id}`,
        title,
        prompt: String(prompt),
        negative: "",
        category: "image",
        tools: uniq((c.taxonomy?.model || []).filter((m) => m && m !== "universal")),
        tags: uniq([...(c.tags?.en || []), ...(c.tags?.zh || []), ...(c.taxonomy?.deliverable || [])]),
        language: c.prompt?.language || detectLang(prompt),
        source: sourceMeta(src),
        author: "hongforge",
      });
    }
    for (const t of raw.templates || []) {
      const prompt = pickHfText(t.prompt);
      if (!prompt || prompt.length < 20) continue;
      const title =
        ((typeof t.title === "string" ? t.title : t.title?.en || t.title?.zh) || t.id) +
        " (template)";
      out.push({
        id: `hf-tpl-${t.id}`,
        title,
        prompt: String(prompt),
        negative: "",
        category: "image",
        tools: uniq((t.taxonomy?.model || []).filter((m) => m && m !== "universal")),
        tags: uniq([...(t.taxonomy?.deliverable || []), "template"]),
        language: detectLang(prompt),
        source: sourceMeta(src),
        author: "hongforge",
      });
    }
    return out;
  }

  function parseSeedanceMd(md, path) {
    const titleMatch = md.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : path.split("/").pop().replace(/\.md$/, "");
    const fence =
      md.match(/\*\*Prompt:\*\*\s*```(?:text|prompt|markdown)?\s*([\s\S]*?)```/i) ||
      md.match(/```(?:text|prompt)\s*([\s\S]*?)```/i);
    if (!fence) return null;
    const prompt = fence[1].trim();
    if (prompt.length < 30) return null;
    const tag = (path.split("/")[1] || "video").replace(/^\d+-/, "");
    return { title, prompt, tag };
  }

  async function adaptSeedanceLive(src) {
    // Live browser cannot use gh api; use jsDelivr GitHub content listing via known tree raw
    // Fall back: fetch README category indexes is fragile. Use GitHub API unauthenticated tree.
    const treeUrl =
      "https://api.github.com/repos/HuyLe82US/awesome-seedance-prompts/git/trees/main?recursive=1";
    const treeRes = await fetch(treeUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!treeRes.ok) throw new Error(`GitHub tree HTTP ${treeRes.status}`);
    const tree = await treeRes.json();
    const paths = (tree.tree || [])
      .filter((t) => t.type === "blob" && /^prompts\/.*\.md$/i.test(t.path) && !/README\.md$/i.test(t.path))
      .map((t) => t.path);

    const out = [];
    const concurrency = 5;
    let i = 0;
    async function worker() {
      while (i < paths.length) {
        const path = paths[i++];
        try {
          const url = `https://cdn.jsdelivr.net/gh/HuyLe82US/awesome-seedance-prompts@main/${path}`;
          const mdRes = await fetch(url);
          if (!mdRes.ok) continue;
          const md = await mdRes.text();
          const parsed = parseSeedanceMd(md, path);
          if (!parsed) continue;
          out.push({
            id: `sd-${path.replace(/[^\w]+/g, "-")}`,
            title: parsed.title,
            prompt: parsed.prompt,
            negative: "",
            category: "video",
            tools: ["Seedance"],
            tags: uniq([parsed.tag, "video", "seedance"]),
            language: detectLang(parsed.prompt),
            source: sourceMeta(
              src,
              `https://github.com/HuyLe82US/awesome-seedance-prompts/blob/main/${path}`
            ),
            author: "",
          });
        } catch {
          /* skip */
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return out;
  }

  async function adaptCuratedLive(src) {
    const res = await fetch(src.localPath || "data/curated.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`curated HTTP ${res.status}`);
    const raw = await res.json();
    return (raw || []).map((item) => ({
      ...item,
      negative: item.negative || "",
      tools: item.tools || [],
      tags: uniq(item.tags || []),
      source: sourceMeta(src),
      author: "local-curated",
    }));
  }

  async function liveRefresh() {
    els.btnRefresh.disabled = true;
    els.btnRefresh.textContent = "Yenileniyor…";
    els.grid.innerHTML = `<div class="loading"><div class="spinner"></div>Kaynaklardan canlı çekiliyor…</div>`;
    const registry = await loadSourcesRegistry();
    const merged = [];
    const status = {};

    for (const src of registry.sources) {
      try {
        let items = [];
        if (src.adapter === "prompt-vault") {
          const res = await fetch(src.fetch);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          items = adaptPromptVault(await res.json(), src);
        } else if (src.adapter === "hongforge") {
          const res = await fetch(src.fetch);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          items = adaptHongforge(await res.json(), src);
        } else if (src.adapter === "seedance-video") {
          items = await adaptSeedanceLive(src);
        } else if (src.adapter === "local-curated") {
          items = await adaptCuratedLive(src);
        }
        status[src.id] = { ok: true, count: items.length };
        merged.push(...items);
      } catch (err) {
        status[src.id] = { ok: false, count: 0, error: err.message };
      }
    }

    // de-dupe
    const seen = new Set();
    state.prompts = merged.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    state.sourceStatus = status;
    state.loadedFrom = "live";
    rebuildFilters();
    render();
    els.btnRefresh.disabled = false;
    els.btnRefresh.textContent = "Kaynaklardan yenile";
  }

  function collectFacets(list) {
    const tools = new Map();
    const sources = new Map();
    const tags = new Map();
    for (const p of list) {
      for (const t of p.tools || []) tools.set(t, (tools.get(t) || 0) + 1);
      const sid = p.source?.id || "unknown";
      sources.set(sid, (sources.get(sid) || 0) + 1);
      for (const tag of p.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
    }
    const sortMap = (m) =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      tools: sortMap(tools),
      sources: sortMap(sources),
      tags: sortMap(tags).slice(0, 24),
    };
  }

  function chipRow(container, items, key, allLabel) {
    const active = state.filter[key];
    container.innerHTML = "";
    const mk = (value, label, extraClass = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip ${extraClass} ${active === value ? "active" : ""}`;
      b.textContent = label;
      b.dataset.value = value;
      b.addEventListener("click", () => {
        state.filter[key] = value;
        rebuildFilters();
        render();
      });
      container.appendChild(b);
    };
    mk("all", allLabel);
    for (const [value, count] of items) {
      mk(value, `${value} (${count})`, key === "category" ? `cat-${value}` : "");
    }
  }

  function rebuildFilters() {
    const facets = collectFacets(state.prompts);
    // category fixed
    const cats = [
      ["image", state.prompts.filter((p) => p.category === "image").length],
      ["video", state.prompts.filter((p) => p.category === "video").length],
    ];
    chipRow(els.catChips, cats, "category", `Tümü (${state.prompts.length})`);
    // fix classes for cat chips
    $$(".chip", els.catChips).forEach((c) => {
      if (c.dataset.value === "image") c.classList.add("cat-image");
      if (c.dataset.value === "video") c.classList.add("cat-video");
    });
    chipRow(els.toolChips, facets.tools.slice(0, 16), "tool", "Tüm araçlar");
    chipRow(els.sourceChips, facets.sources, "source", "Tüm kaynaklar");
    chipRow(els.tagChips, facets.tags, "tag", "Tüm etiketler");
  }

  function filtered() {
    const q = state.filter.q.trim().toLowerCase();
    const list = state.prompts.filter((p) => {
      if (state.filter.category !== "all" && p.category !== state.filter.category) return false;
      if (state.filter.tool !== "all" && !(p.tools || []).includes(state.filter.tool)) return false;
      if (state.filter.source !== "all" && p.source?.id !== state.filter.source) return false;
      if (state.filter.tag !== "all" && !(p.tags || []).includes(state.filter.tag)) return false;
      if (!q) return true;
      const hay = [p.title, p.prompt, p.author, ...(p.tags || []), ...(p.tools || []), p.source?.name]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    // Prefer prompts with example images first (stable within groups)
    list.sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)));
    return list;
  }

  function renderSourceBadges() {
    const registry = state.sources?.sources || [];
    const ids = registry.length
      ? registry.map((s) => s.id)
      : Object.keys(state.sourceStatus);
    els.sourceBadges.innerHTML = ids
      .map((id) => {
        const st = state.sourceStatus[id];
        if (!st) return `<span class="source-badge">${esc(id)}</span>`;
        if (st.ok)
          return `<span class="source-badge ok">${esc(id)} · ${st.count}</span>`;
        return `<span class="source-badge err" title="${esc(st.error || "")}">${esc(id)} · hata</span>`;
      })
      .join("");
  }

  function renderFooterSources() {
    const list = state.sources?.sources;
    if (!list) {
      els.footerSources.innerHTML = "<li>Kaynak listesi yüklenemedi</li>";
      return;
    }
    els.footerSources.innerHTML = list
      .map(
        (s) =>
          `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> <span>(${esc(s.license || "—")})</span> — <code>${esc(s.repo)}</code></li>`
      )
      .join("");
  }

  function renderCards(list) {
    if (!list.length) {
      els.grid.innerHTML = `<div class="empty">Sonuç yok. Filtreleri temizleyin veya başka bir arama deneyin.</div>`;
      return;
    }
    // Virtual-ish: render first 300 then "show more"
    const LIMIT = 300;
    const slice = list.slice(0, LIMIT);
    const html = slice
      .map((p) => {
        const tags = (p.tags || [])
          .slice(0, 5)
          .map((t) => `<span class="tag">${esc(t)}</span>`)
          .join("");
        const thumb = p.image
          ? `<img class="card-thumb" loading="lazy" decoding="async" src="${esc(p.image)}" alt="" onerror="this.hidden=true" />`
          : "";
        return `<article class="card" data-id="${esc(p.id)}" tabindex="0" role="button">
          ${thumb}
          <div class="card-body">
            <div class="card-top">
              <h3 class="card-title">${esc(p.title)}</h3>
              <span class="cat-dot ${esc(p.category)}">${p.category === "video" ? "video" : "görsel"}</span>
            </div>
            <p class="card-prompt">${esc(truncate(p.prompt, 240))}</p>
            <div class="card-tags">${tags}</div>
            <div class="card-foot">
              <span class="card-source" title="${esc(p.source?.repo || "")}">${esc(p.source?.name || p.source?.id || "")}</span>
              <button type="button" class="btn btn-copy" data-copy="${esc(p.id)}">Kopyala</button>
            </div>
          </div>
        </article>`;
      })
      .join("");
    const more =
      list.length > LIMIT
        ? `<div class="empty">İlk ${LIMIT} sonuç gösteriliyor (${list.length} eşleşme). Aramayı daraltın.</div>`
        : "";
    els.grid.innerHTML = html + more;
  }

  function render() {
    const list = filtered();
    const n = list.length.toLocaleString("tr-TR");
    els.countPill.textContent = `${state.prompts.length.toLocaleString("tr-TR")} prompt`;
    if (els.resultsCount) els.resultsCount.textContent = `${n} sonuç`;
    els.statusText.textContent = `${n} sonuç · ${
      state.loadedFrom === "live" ? "canlı kaynaklar" : "yerel snapshot"
    }`;
    renderSourceBadges();
    renderCards(list);
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Kopyalandı ✓";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove("copied");
      }, 1400);
    }
  }

  function openModal(p) {
    activePrompt = p;
    els.modalTitle.textContent = p.title;
    if (p.image && els.modalImage && els.modalImageWrap) {
      els.modalImage.src = p.image;
      els.modalImage.alt = p.title || "";
      els.modalImage.onerror = () => {
        els.modalImageWrap.hidden = true;
      };
      els.modalImageWrap.hidden = false;
    } else if (els.modalImageWrap) {
      if (els.modalImage) els.modalImage.removeAttribute("src");
      els.modalImageWrap.hidden = true;
    }
    els.modalMeta.innerHTML = `
      <span class="cat-dot ${esc(p.category)}">${p.category}</span>
      ${(p.tools || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
      <span class="tag">${esc(p.language || "")}</span>
      <a href="${esc(p.source?.itemUrl || p.source?.url || "#")}" target="_blank" rel="noopener">${esc(p.source?.name || "")}</a>
      ${p.author ? `<span>· ${esc(p.author)}</span>` : ""}
    `;
    els.modalPrompt.textContent = p.prompt;
    if (p.negative) {
      els.modalNeg.hidden = false;
      els.modalNeg.innerHTML = `<strong>Negative:</strong> ${esc(p.negative)}`;
    } else {
      els.modalNeg.hidden = true;
    }
    els.modalOpenSource.href = p.source?.itemUrl || p.source?.url || "#";
    els.modal.classList.add("open");
    els.modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    els.modal.classList.remove("open");
    els.modal.setAttribute("aria-hidden", "true");
    activePrompt = null;
  }

  function byId(id) {
    return state.prompts.find((p) => p.id === id);
  }

  function setAdvancedFiltersOpen(open) {
    if (!els.advancedFilters || !els.btnFilters) return;
    els.advancedFilters.hidden = !open;
    els.btnFilters.setAttribute("aria-expanded", open ? "true" : "false");
    els.btnFilters.textContent = open ? "Filtreler ▴" : "Filtreler ▾";
  }

  function bind() {
    // Mobile: advanced filters closed; desktop: open
    const desktop = window.matchMedia("(min-width: 768px)").matches;
    setAdvancedFiltersOpen(desktop);
    if (els.btnFilters) {
      els.btnFilters.addEventListener("click", () => {
        const open = els.btnFilters.getAttribute("aria-expanded") !== "true";
        setAdvancedFiltersOpen(open);
      });
    }

    let t = null;
    els.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.filter.q = els.search.value;
        render();
      }, 120);
    });

    els.grid.addEventListener("click", (e) => {
      const copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) {
        e.stopPropagation();
        const p = byId(copyBtn.dataset.copy);
        if (p) copyText(p.prompt, copyBtn);
        return;
      }
      const card = e.target.closest(".card");
      if (card) {
        const p = byId(card.dataset.id);
        if (p) openModal(p);
      }
    });

    els.grid.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".card");
      if (!card) return;
      e.preventDefault();
      const p = byId(card.dataset.id);
      if (p) openModal(p);
    });

    els.modalCopy.addEventListener("click", () => {
      if (activePrompt) copyText(activePrompt.prompt, els.modalCopy);
    });
    els.modalClose.addEventListener("click", closeModal);
    els.modal.addEventListener("click", (e) => {
      if (e.target === els.modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    els.btnRefresh.addEventListener("click", () => {
      liveRefresh().catch((err) => {
        els.grid.innerHTML = `<div class="error-box">Canlı yenileme başarısız: ${esc(err.message)}. Snapshot kullanılmaya devam ediyor.</div>`;
        els.btnRefresh.disabled = false;
        els.btnRefresh.textContent = "Kaynaklardan yenile";
        rebuildFilters();
        render();
      });
    });
  }

  async function init() {
    bind();
    try {
      await loadSourcesRegistry();
      renderFooterSources();
    } catch {
      /* optional */
    }
    try {
      await loadSnapshot();
      rebuildFilters();
      render();
    } catch (err) {
      els.grid.innerHTML = `<div class="error-box">Snapshot yüklenemedi (${esc(err.message)}). “Kaynaklardan yenile” ile deneyin.</div>`;
      els.countPill.textContent = "0 prompt";
    }
  }

  init();
})();
