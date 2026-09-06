#!/usr/bin/env node
/**
 * sync.mjs — pull public GitHub prompt pools → data/prompts.json
 * Node ESM, no heavy deps. Run: node scripts/sync.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "ai-prompt-havuzu-sync" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  return { data: JSON.parse(text), bytes: Buffer.byteLength(text, "utf8") };
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "ai-prompt-havuzu-sync" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
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
  if (!prompt) return fallback;
  const line = String(prompt).split(/\n/).map((l) => l.trim()).find(Boolean) || fallback;
  const clean = line.replace(/^[#*\-\s]+/, "").slice(0, 80);
  return clean.length < line.length && clean.length === 80 ? clean + "…" : clean;
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

function uniqTags(tags) {
  const out = [];
  const seen = new Set();
  for (const t of tags || []) {
    const s = String(t || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/* ---------- adapters ---------- */

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

function adaptPromptVault(raw, src, { snapshot = true } = {}) {
  const arr = Array.isArray(raw) ? raw : [];
  let items = arr;
  // snapshot: up to 2000, or all if source file < 8MB (caller passes bytes)
  const out = [];
  for (const item of items) {
    if (!item?.prompt) continue;
    const tools = item.tool ? [String(item.tool)] : [];
    const tags = uniqTags([...(item.tags || []), item.style].filter(Boolean));
    const image = resolvePromptVaultImage(item);
    const entry = {
      id: `pv-${item.id || out.length}`,
      title: titleFromPrompt(item.prompt, item.id || "prompt-vault"),
      prompt: String(item.prompt),
      negative: "",
      category: "image",
      tools,
      tags,
      language: detectLang(item.prompt),
      source: sourceMeta(src, item.source_url || src.url),
      author: item.author || "",
    };
    if (image) entry.image = image;
    out.push(entry);
  }
  return out;
}

function pickHongforgeText(promptObj) {
  if (!promptObj) return "";
  if (typeof promptObj === "string") return promptObj;
  // cases: { language, text: {en, zh}, ... }
  if (promptObj.text) {
    const t = promptObj.text;
    if (typeof t === "string") return t;
    return t.en || t.zh || Object.values(t).find((v) => typeof v === "string") || "";
  }
  // templates: { zh, en }
  return promptObj.en || promptObj.zh || "";
}

function pickTitle(titleObj, fallback) {
  if (!titleObj) return fallback;
  if (typeof titleObj === "string") return titleObj;
  return titleObj.en || titleObj.zh || fallback;
}

function adaptHongforge(raw, src) {
  const out = [];
  const cases = Array.isArray(raw?.cases) ? raw.cases : [];
  const templates = Array.isArray(raw?.templates) ? raw.templates : [];

  for (const c of cases) {
    const prompt = pickHongforgeText(c.prompt);
    if (!prompt || prompt.length < 20) continue;
    const tagsZh = c.tags?.zh || [];
    const tagsEn = c.tags?.en || [];
    const tools = uniqTags([...(c.taxonomy?.model || [])].filter((m) => m && m !== "universal"));
    const lang = c.prompt?.language || detectLang(prompt);
    out.push({
      id: `hf-case-${c.id}`,
      title: pickTitle(c.title, c.id),
      prompt: String(prompt),
      negative: "",
      category: "image",
      tools: tools.length ? tools : ["GPT Image"],
      tags: uniqTags([...tagsEn, ...tagsZh, ...(c.taxonomy?.deliverable || [])]),
      language: lang === "bilingual" ? "bilingual" : detectLang(prompt),
      source: sourceMeta(src, `${src.url}/blob/main/data/prompt-library.json`),
      author: "hongforge",
    });
  }

  for (const t of templates) {
    const prompt = pickHongforgeText(t.prompt);
    if (!prompt || prompt.length < 20) continue;
    out.push({
      id: `hf-tpl-${t.id}`,
      title: pickTitle(t.title, t.id) + " (template)",
      prompt: String(prompt),
      negative: "",
      category: "image",
      tools: uniqTags([...(t.taxonomy?.model || [])].filter((m) => m && m !== "universal")),
      tags: uniqTags([...(t.taxonomy?.deliverable || []), "template"]),
      language: detectLang(prompt),
      source: sourceMeta(src, `${src.url}/blob/main/data/prompt-library.json`),
      author: "hongforge",
    });
  }
  return out;
}

function parseSeedanceMarkdown(md, path) {
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : path.split("/").pop().replace(/\.md$/, "");
  // **Prompt:** then fenced ```text ... ```
  const fence =
    md.match(/\*\*Prompt:\*\*\s*```(?:text|prompt|markdown)?\s*([\s\S]*?)```/i) ||
    md.match(/##\s*Prompt\s*```(?:text|prompt)?\s*([\s\S]*?)```/i) ||
    md.match(/```(?:text|prompt)\s*([\s\S]*?)```/i);
  if (!fence) return null;
  const prompt = fence[1].trim();
  if (prompt.length < 30) return null;
  const catFolder = path.split("/")[1] || "video"; // prompts/01-cinematic-vfx/...
  const tag = catFolder.replace(/^\d+-/, "");
  return { title, prompt, tag };
}

async function listSeedanceFiles() {
  // Prefer gh api (authenticated, reliable); parse JSON in Node (avoid jq regex escapes)
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["api", "repos/HuyLe82US/awesome-seedance-prompts/git/trees/main?recursive=1"],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const tree = JSON.parse(stdout);
    return (tree.tree || [])
      .filter(
        (t) =>
          t.type === "blob" &&
          /^prompts\/.*\.md$/i.test(t.path) &&
          !/README\.md$/i.test(t.path)
      )
      .map((t) => t.path);
  } catch (e) {
    console.warn("gh api tree failed:", e.message);
    return [];
  }
}

async function fetchSeedanceFile(path) {
  // Try gh api contents first
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["api", `repos/HuyLe82US/awesome-seedance-prompts/contents/${path}`, "--jq", ".content"],
      { maxBuffer: 5 * 1024 * 1024 }
    );
    const b64 = stdout.trim().replace(/\n/g, "");
    if (b64) return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    /* fall through */
  }
  const rawUrl = `https://raw.githubusercontent.com/HuyLe82US/awesome-seedance-prompts/main/${path}`;
  return await fetchText(rawUrl);
}

async function adaptSeedance(src) {
  const paths = await listSeedanceFiles();
  console.log(`  seedance: ${paths.length} markdown files`);
  const out = [];
  // concurrency limited
  const concurrency = 6;
  let i = 0;
  async function worker() {
    while (i < paths.length) {
      const idx = i++;
      const path = paths[idx];
      try {
        const md = await fetchSeedanceFile(path);
        const parsed = parseSeedanceMarkdown(md, path);
        if (!parsed) {
          console.warn(`  skip (no Prompt block): ${path}`);
          continue;
        }
        out.push({
          id: `sd-${path.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}`,
          title: parsed.title,
          prompt: parsed.prompt,
          negative: "",
          category: "video",
          tools: ["Seedance"],
          tags: uniqTags([parsed.tag, "video", "seedance"]),
          language: detectLang(parsed.prompt),
          source: sourceMeta(
            src,
            `https://github.com/HuyLe82US/awesome-seedance-prompts/blob/main/${path}`
          ),
          author: "",
        });
      } catch (err) {
        console.warn(`  fail ${path}: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

function adaptCurated(raw, src) {
  return (Array.isArray(raw) ? raw : []).map((item) => ({
    id: item.id,
    title: item.title,
    prompt: item.prompt,
    negative: item.negative || "",
    category: item.category || "image",
    tools: item.tools || [],
    tags: uniqTags(item.tags || []),
    language: item.language || detectLang(item.prompt),
    source: sourceMeta(src, src.url),
    author: "local-curated",
  }));
}

/* ---------- main ---------- */

async function main() {
  const sourcesPath = join(ROOT, "data", "sources.json");
  const registry = JSON.parse(await readFile(sourcesPath, "utf8"));
  const all = [];
  const counts = {};
  const errors = [];

  for (const src of registry.sources) {
    process.stdout.write(`→ ${src.id} ... `);
    try {
      let items = [];
      if (src.adapter === "prompt-vault") {
        const { data, bytes } = await fetchJson(src.fetch);
        let adapted = adaptPromptVault(data, src);
        const limit = src.snapshotLimit ?? 2000;
        const under = bytes < (src.snapshotIncludeAllIfUnderBytes ?? MAX_SNAPSHOT_BYTES);
        if (!under && adapted.length > limit) {
          adapted = adapted.slice(0, limit);
          console.log(`fetched ${data.length} raw (${(bytes / 1e6).toFixed(2)}MB) → snapshot ${adapted.length} (capped)`);
        } else {
          // include all if under 8MB, else still respect soft cap at 2000... Spec: up to 2000 OR all if <8MB
          if (under) {
            console.log(`fetched ${adapted.length} (source ${(bytes / 1e6).toFixed(2)}MB <8MB → all)`);
          } else {
            adapted = adapted.slice(0, limit);
            console.log(`snapshot ${adapted.length}`);
          }
        }
        // Soft safety: if resulting JSON would be huge, still ok — include all when under 8MB per spec
        items = adapted;
      } else if (src.adapter === "hongforge") {
        const { data } = await fetchJson(src.fetch);
        items = adaptHongforge(data, src);
        console.log(`${items.length} (cases+templates)`);
      } else if (src.adapter === "seedance-video") {
        items = await adaptSeedance(src);
        console.log(`${items.length} prompts`);
      } else if (src.adapter === "local-curated") {
        const local = JSON.parse(await readFile(join(ROOT, src.localPath), "utf8"));
        items = adaptCurated(local, src);
        console.log(`${items.length}`);
      } else {
        throw new Error(`Unknown adapter ${src.adapter}`);
      }
      counts[src.id] = items.length;
      all.push(...items);
    } catch (err) {
      counts[src.id] = 0;
      errors.push({ id: src.id, error: err.message });
      console.log(`FAILED: ${err.message}`);
    }
  }

  // de-dupe by id
  const seen = new Set();
  const unique = [];
  for (const p of all) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    unique.push(p);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    total: unique.length,
    counts,
    errors,
    prompts: unique,
  };

  await mkdir(join(ROOT, "data"), { recursive: true });
  const outPath = join(ROOT, "data", "prompts.json");
  await writeFile(outPath, JSON.stringify(payload, null, 0), "utf8");
  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  console.log("\n=== sync complete ===");
  console.log(`total: ${unique.length}`);
  console.log("per-source:", counts);
  if (errors.length) console.log("errors:", errors);
  console.log(`wrote ${outPath} (${(size / 1e6).toFixed(2)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
