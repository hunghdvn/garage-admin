import fs from 'fs'

const en = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8'))
const keys = Object.keys(en)
const langs = ['ja','ko','zh']
const mymemoryLang = { es:'es', it:'it', ja:'ja', ko:'ko', zh:'zh-CN' }

async function translateOne(text, target) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${mymemoryLang[target]}`
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(url, { signal: ctrl.signal })
      clearTimeout(tid)
      const data = await res.json()
      const t = data?.responseData?.translatedText
      if (t && !t.includes('MYMEMORY WARNING')) return t
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
  }
  return text
}

async function translateLang(lang) {
  const out = {}
  const concurrency = 2
  let i = 0
  async function worker() {
    while (i < keys.length) {
      const idx = i++
      const k = keys[idx]
      out[k] = await translateOne(en[k], lang)
      if (idx % 25 === 0) console.log(lang, idx, '/', keys.length)
      await new Promise(r => setTimeout(r, 300))
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  fs.writeFileSync(`src/i18n/locales/${lang}.json`, JSON.stringify(out, null, 2))
  console.log('DONE', lang)
}

for (const lang of langs) {
  await translateLang(lang)
}
console.log('ALL DONE')
PY