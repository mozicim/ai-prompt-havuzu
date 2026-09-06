# AI Prompt Havuzu

Türkçe öncelikli, hızlı bir **HTML prompt tarayıcısı**. Birden fazla genel GitHub prompt havuzundan beslenir; arama, filtreleme ve tek tıkla kopyalama sunar.

**GitHub Pages:** https://mozicim.github.io/ai-prompt-havuzu/

**Repo:** https://github.com/mozicim/ai-prompt-havuzu

## Özellikler

- Yüzlerce–binlerce prompt (snapshot + canlı yenileme)
- Görsel / video filtreleri, araç, kaynak ve etiket chip’leri
- Her kartta kaynak repo atfı
- `data/prompts.json` ile anında açılış (GitHub Pages dostu)
- “Kaynaklardan yenile” ile tarayıcıdan canlı çekim

## Yapı

```
index.html          # UI kabuğu (Türkçe)
assets/app.js       # yükleme, arama, render, kopyalama
assets/styles.css   # koyu modern arayüz
data/sources.json   # kaynak kaydı
data/prompts.json   # önceden üretilmiş snapshot
data/curated.json   # yerel kürasyon (~38 orijinal prompt)
scripts/sync.mjs    # kaynakları çekip prompts.json üretir
```

## Kaynaklar

| id | repo | not |
|----|------|-----|
| `prompt-vault` | [coldxiangyu163/prompt-vault](https://github.com/coldxiangyu163/prompt-vault) | jsDelivr JSON; görsel |
| `hongforge` | [hongforge/ai_skills](https://github.com/hongforge/ai_skills) (MIT) | cases + templates |
| `seedance-video` | [HuyLe82US/awesome-seedance-prompts](https://github.com/HuyLe82US/awesome-seedance-prompts) (MIT) | markdown `**Prompt:**` blokları |
| `local-curated` | bu repo | kafe / ürün / reel / yemek odaklı orijinal promptlar |

Üçüncü taraf prompt metinleri kendi lisanslarını korur. Bu uygulamanın **kodu** MIT’tir (`LICENSE`).

## Yerel kullanım

Statik dosyalar olarak açılabilir (relative path). En kolayı:

```bash
npx serve .
# veya
python3 -m http.server 8080
```

Ardından `index.html` adresine gidin.

## Snapshot’ı yenileme (sync)

Node 18+ gerekir (`fetch` native).

```bash
node scripts/sync.mjs
```

Script:

1. `data/sources.json` okur
2. Her adapter ile kaynakları çeker / normalize eder
3. `data/prompts.json` yazar ve sayıları basar

`seedance-video` için `gh` CLI (kimlik doğrulamalı) kullanılır; yoksa raw URL’lere düşer.

## GitHub Pages

`main` dalının kökünden (`/`) yayınlanır. Pages kapalıysa:

1. Repo → Settings → Pages
2. Source: Deploy from a branch → `main` / `/ (root)`

veya:

```bash
gh api repos/mozicim/ai-prompt-havuzu/pages -X PUT \
  -f build_type=legacy \
  -f source[branch]=main \
  -f source[path]=/
```

## Lisans

MIT — yalnızca bu depodaki uygulama kodu ve `local-curated` promptlar. Harici havuz içerikleri için ilgili repolara bakın.
