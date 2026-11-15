import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STORE_FILE = path.join(DATA_DIR, 'portal_store.json');
const TESTS_DIR = path.join(DATA_DIR, 'tests');
const PDFS_DIR = path.join(DATA_DIR, 'pdfs');
const PUBLIC_STATIC_DIR = path.join(ROOT_DIR, 'public', 'static-store');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DIST_STATIC_DIR = path.join(DIST_DIR, 'static-store');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureImageDataUrlServer(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (
    s.startsWith('data:image/') ||
    /^https?:\/\//i.test(s) ||
    (s.startsWith('/') && !s.startsWith('/9j/'))
  ) {
    return s;
  }
  const c = s.replace(/\s+/g, '');
  if (c.startsWith('iVBORw0KGgo')) return `data:image/png;base64,${c}`;
  if (c.startsWith('/9j/')) return `data:image/jpeg;base64,${c}`;
  if (c.startsWith('UklGR')) return `data:image/webp;base64,${c}`;
  if (c.startsWith('R0lGOD')) return `data:image/gif;base64,${c}`;
  return '';
}

function decodeDataUrlToBuffer(dataUrl) {
  if (!dataUrl) return null;
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  if (!b64 || b64.length < 16) return null;
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

function readTestFileSync(safeId) {
  const binPath = path.join(TESTS_DIR, `${safeId}.bin`);
  if (fs.existsSync(binPath)) {
    try {
      const buf = fs.readFileSync(binPath);
      if (buf.byteLength >= 4) {
        const headerLen = buf.readUInt32LE(0);
        if (headerLen > 0 && 4 + headerLen <= buf.byteLength) {
          const headerStr = buf.subarray(4, 4 + headerLen).toString('utf-8');
          const header = JSON.parse(headerStr);
          const rawHtml =
            4 + headerLen < buf.byteLength
              ? buf.subarray(4 + headerLen).toString('utf-8')
              : '';
          return {
            meta: header.meta,
            questions: Array.isArray(header.questions) ? header.questions : [],
            rawHtml,
          };
        }
      }
    } catch {
      // fall through
    }
  }
  const jsonPath = path.join(TESTS_DIR, `${safeId}.json`);
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        meta: parsed.meta,
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
        rawHtml: typeof parsed.rawHtml === 'string' ? parsed.rawHtml : '',
      };
    } catch {
      // ignore
    }
  }
  return null;
}

function patchHtmlForPortalIframe(sourceHtml, opts) {
  const trimmed = String(sourceHtml || '').trim();
  if (!trimmed) return '';

  const tailOffset = Math.max(0, trimmed.length - 8192);
  const cleanedTail = trimmed
    .slice(tailOffset)
    .replace(/<script>\(function\(\)\{function c\(\)\{var b=a\.contentDocument[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*beacon\.min\.js[^>]*>[\s\S]*?<\/script>/gi, '');

  let baseHtml = (trimmed.slice(0, tailOffset) + cleanedTail)
    .replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<script[^>]+cdn-cgi[^>]*>[\s\S]*?<\/script>/gi, '');

  if (!/<body[\s>]/i.test(baseHtml)) {
    const escapedTitle = String(opts.title || 'VS Test').replace(/</g, '&lt;');
    baseHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapedTitle}</title></head><body>${baseHtml}</body></html>`;
  } else if (!/<head[\s>]/i.test(baseHtml)) {
    const htmlTagMatch = /<html[^>]*>/i.exec(baseHtml);
    if (htmlTagMatch && typeof htmlTagMatch.index === 'number') {
      const pos = htmlTagMatch.index + htmlTagMatch[0].length;
      baseHtml = `${baseHtml.slice(0, pos)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head>${baseHtml.slice(pos)}`;
    } else {
      baseHtml = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head>${baseHtml}`;
    }
  }

  const preBootSanitizerScript = `<script>
(function(){
  try {
    try { window.alert = function(){}; } catch(e) {}
    try { window.confirm = function(){ return true; }; } catch(e) {}
    try { window.open = function(){ return null; }; } catch(e) {}
    window.addEventListener('error', function(ev) {
      if (ev && ev.message && (ev.message.indexOf('Script error') !== -1 || ev.message.indexOf('ResizeObserver') !== -1)) {
        ev.preventDefault();
      }
    });
    window.addEventListener('unhandledrejection', function(ev) {
      try { ev.preventDefault(); } catch(e) {}
    });
    var TEST_ISO_ID = ${JSON.stringify(opts.testId || 'default_test')};
    var GENERIC_CBT_KEYS = { cbt_answers: 1, cbt_marked: 1, cbt_visited: 1, cbt_start: 1, cbt_submitted: 1, cbt_timePerQ: 1, cbt_theme: 1 };
    var origGetItem = Storage.prototype.getItem;
    var origSetItem = Storage.prototype.setItem;
    var origRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function(k) {
      try {
        var mapped = (this === window.localStorage && GENERIC_CBT_KEYS[k]) ? ('vs_iso_' + TEST_ISO_ID + '_' + k) : k;
        return origGetItem.call(this, mapped);
      } catch(e) { return null; }
    };
    Storage.prototype.setItem = function(k, v) {
      try {
        var mapped = (this === window.localStorage && GENERIC_CBT_KEYS[k]) ? ('vs_iso_' + TEST_ISO_ID + '_' + k) : k;
        return origSetItem.call(this, mapped, v);
      } catch(e) {}
    };
    Storage.prototype.removeItem = function(k) {
      try {
        var mapped = (this === window.localStorage && GENERIC_CBT_KEYS[k]) ? ('vs_iso_' + TEST_ISO_ID + '_' + k) : k;
        return origRemoveItem.call(this, mapped);
      } catch(e) {}
    };
  } catch (e) {}
})();
</script>`;

  const headMatch = /<head[^>]*>/i.exec(baseHtml);
  if (headMatch && typeof headMatch.index === 'number') {
    const insertPos = headMatch.index + headMatch[0].length;
    baseHtml = baseHtml.slice(0, insertPos) + preBootSanitizerScript + baseHtml.slice(insertPos);
  } else {
    baseHtml = `${preBootSanitizerScript}${baseHtml}`;
  }

  const bridgeScript = `<script>
(function(){
  function ensureBackButton() {
    try {
      if (document.getElementById('vsPortalBackBtn')) return;
      var brand = document.querySelector('.brand, .exam-header, .hdr, .header, .topbar, header') || document.body;
      if (!brand) return;
      var backBtn = document.createElement('button');
      backBtn.id = 'vsPortalBackBtn';
      backBtn.type = 'button';
      backBtn.textContent = '← Home';
      backBtn.style.cssText = 'border:1px solid #b9dced;background:#ffffff;color:#145d88;border-radius:10px;padding:7px 11px;font-weight:800;font-size:12px;cursor:pointer;flex-shrink:0;margin-right:6px;z-index:2147483647;position:relative;';
      backBtn.onclick = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        try { window.parent.postMessage({ type: 'VS_CBT_HTML_EXIT' }, '*'); } catch(err) {}
      };
      if (brand === document.body) {
        backBtn.style.position = 'fixed';
        backBtn.style.top = '10px';
        backBtn.style.left = '10px';
        document.body.appendChild(backBtn);
      } else {
        brand.insertBefore(backBtn, brand.firstChild);
      }
    } catch(e) {}
  }
  function signalReady() {
    ensureBackButton();
    try { window.parent.postMessage({ type: 'VS_CBT_HTML_BRIDGE_READY' }, '*'); } catch(e) {}
  }
  signalReady();
  document.addEventListener('DOMContentLoaded', signalReady);
  window.addEventListener('load', signalReady);
})();
</script>`;

  if (/<\/body>/i.test(baseHtml)) {
    return baseHtml.replace(/<\/body>/i, `${bridgeScript}</body>`);
  }
  return `${baseHtml}${bridgeScript}`;
}

function buildStandaloneCbtHtmlForStatic(meta, questions) {
  const rawTestId = String(meta?.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const N = questions.length || Number(meta?.totalQuestions) || 90;
  const rawDur = Number(meta?.durationMinutes) || 90;
  const DURATION = (rawDur <= 6 ? rawDur * 60 : Math.max(60, rawDur)) * 60;
  const MAX = Number(meta?.maxMarks) || N * 4;
  const compactQs = questions.map((q, idx) => {
    const imgs = Array.isArray(q.imageUrls) ? q.imageUrls : [];
    const rawHiImg =
      ensureImageDataUrlServer(q.imageHi) ||
      ensureImageDataUrlServer(imgs[0]) ||
      ensureImageDataUrlServer(q.imageUrl) ||
      ensureImageDataUrlServer(q.questionHi);
    const rawEnImg =
      ensureImageDataUrlServer(q.imageEn) ||
      ensureImageDataUrlServer(imgs[1]) ||
      ensureImageDataUrlServer(q.questionEn);

    const hiImg =
      rawHiImg && rawHiImg.startsWith('data:image/') && rawTestId && (idx > 0 || rawHiImg.length > 120000)
        ? `/static-store/qimg/${encodeURIComponent(rawTestId)}/${idx}_hi.png`
        : rawHiImg;
    const enImg =
      rawEnImg && rawEnImg.startsWith('data:image/') && rawTestId && (idx > 0 || rawEnImg.length > 120000)
        ? rawEnImg === rawHiImg
          ? hiImg
          : `/static-store/qimg/${encodeURIComponent(rawTestId)}/${idx}_en.png`
        : rawEnImg;

    const optsHiRaw = Array.isArray(q.optionsHi) ? q.optionsHi : [];
    const optsEnRaw = Array.isArray(q.optionsEn) ? q.optionsEn : [];
    const rawAns = String(q.correctAnswer ?? q.answer ?? q.ans ?? '1').trim().toUpperCase();
    const mappedAns =
      rawAns === 'A' ? 1 : rawAns === 'B' ? 2 : rawAns === 'C' ? 3 : rawAns === 'D' ? 4 : Number(rawAns.replace(/[^1-4]/g, '')) || 1;
    const expObj = q.explanation && typeof q.explanation === 'object' ? q.explanation : null;
    return {
      q: idx + 1,
      chapter: String(q.chapter || meta?.chapter || 'NEET Syllabus'),
      hiImg,
      enImg,
      qHi: rawHiImg ? '' : String(q.questionHi || q.questionEn || ''),
      qEn: rawEnImg ? '' : String(q.questionEn || q.questionHi || ''),
      optsHi: optsHiRaw.map((o) => String(typeof o === 'string' ? o : o?.text || '')),
      optsEn: optsEnRaw.map((o) => String(typeof o === 'string' ? o : o?.text || '')),
      ans: mappedAns,
      expHi: String(expObj?.hi || (typeof q.explanation === 'string' ? q.explanation : '') || ''),
      expEn: String(expObj?.en || (typeof q.explanation === 'string' ? q.explanation : '') || ''),
    };
  });

  const safeTitle = String(meta?.title || 'VS TEST NEET').replace(/</g, '&lt;');
  const safeSubTitle = String(meta?.subTitle || 'Bilingual CBT Paper').replace(/</g, '&lt;');
  const safeSubject = String(meta?.subject || 'NEET').replace(/</g, '&lt;');

  return `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${safeTitle}</title><style>:root{--blue:#168acb;--ink:#183449;--line:#c9e5f4}*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#effaff,#dff3ff 48%,#f8fcff);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}button{font:inherit;cursor:pointer}.top{position:sticky;top:0;z-index:5;background:#f7fcffed;backdrop-filter:blur(14px);border-bottom:1px solid var(--line);padding:10px}.brand{max-width:1100px;margin:auto;display:flex;justify-content:space-between;align-items:center;gap:8px}.logo{font-weight:900;color:#145d88}.logo small{display:block;font-size:10px;letter-spacing:2px;color:#6a93aa}.pill{border:1px solid #b9dced;border-radius:999px;padding:8px 11px;background:white;font-weight:800;color:#175b82;font-variant-numeric:tabular-nums}.wrap{max-width:1100px;margin:16px auto;padding:0 12px 30px;display:grid;grid-template-columns:minmax(0,1fr);gap:13px}.panel{background:#ffffffed;border:1px solid var(--line);border-radius:17px;box-shadow:0 10px 28px #3a8db515}.info{padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.sub{font-size:12px;color:#658196;font-weight:650}.tag{font-size:11px;background:#e4f5ff;color:#1c6f9f;padding:5px 9px;border-radius:99px;font-weight:800}.progress{height:6px;background:#e4f1f8;border-radius:9px;overflow:hidden;margin-top:7px}.progress span{display:block;height:100%;background:var(--blue);width:0}.qhead{display:flex;justify-content:space-between;align-items:center;padding:13px 15px;border-bottom:1px solid var(--line)}.qnum{font-weight:900;color:#145d88}.question{padding:12px}.langlabel{font-size:11px;font-weight:900;color:#1b6d99;margin:3px 0 5px}.qimage{display:block;width:100%;height:auto;border:1px solid #d7eaf5;border-radius:9px;background:white}.qtext{font-size:18px;font-weight:750;line-height:1.55;padding:10px 12px;background:#fff;border:1px solid #d7eaf5;border-radius:9px;white-space:pre-line}.lang-switch{background:#eaf7ff;border-color:#9bd5f3;color:#145d88;font-weight:800}.options{display:grid;gap:8px;margin-top:13px}.opt{width:100%;text-align:left;background:#f8fcff;border:1.5px solid #d4e8f4;border-radius:11px;padding:10px 12px;color:var(--ink);display:flex;align-items:center;gap:10px;min-height:46px;font-weight:700}.letter{width:27px;height:27px;border-radius:50%;display:grid;place-items:center;background:#e5f4fc;color:#216b93;font-weight:900;flex:none}.opt.selected{border-color:var(--blue);background:#e9f7ff}.opt.selected .letter{background:var(--blue);color:white}.controls{padding:12px 13px;border-top:1px solid var(--line);display:flex;gap:7px;flex-wrap:wrap}.btn{border:1px solid #b9dced;background:white;color:#1a628b;border-radius:10px;padding:10px 12px;font-weight:800}.primary{background:var(--blue);border-color:var(--blue);color:white}.green{background:#159b69;border-color:#159b69;color:white}.warn{color:#a46a10}.btn:disabled{opacity:.4}.palette-toggle{border:1px solid #a6d6ed;border-radius:11px;padding:8px 10px;color:#17658f;font-weight:800;background:#e8f7ff;white-space:nowrap;min-height:39px}.side{padding:14px;position:fixed;z-index:9;top:65px;right:12px;width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 80px);overflow:auto;box-shadow:0 16px 50px #20597b36;background:#fff}.side[hidden]{display:none}.drawer-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.drawer-head h3{margin:0;font-size:15px}.palette-close{border:1px solid #cce7f3;background:#f2faff;color:#1a628b;border-radius:9px;width:34px;height:34px;font-size:16px}.legend{font-size:11px;color:#658196;margin:10px 0;display:flex;gap:10px;flex-wrap:wrap}.dot{display:inline-block;width:9px;height:9px;border-radius:3px;background:#e5f1f7;margin-right:4px}.dot.done{background:#168acb}.dot.review{background:#e7a72c}.palette{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:10px}.pal{border:1px solid #cfe4ef;border-radius:7px;background:#f8fcff;color:#315b73;padding:7px 0;font-weight:800;font-size:12px}.pal.current{outline:2px solid #145d88}.pal.done{background:var(--blue);border-color:var(--blue);color:white}.pal.review{background:#e7a72c;border-color:#e7a72c;color:white}.question-image-frame{position:relative;isolation:isolate;background:#fff;border-radius:9px;overflow:hidden}.question-image-frame::before{content:"VS";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-23deg);font-weight:900;letter-spacing:.04em;font-size:clamp(70px,17vw,180px);color:rgba(36,145,198,.085);z-index:0;pointer-events:none;white-space:nowrap}.question-image-frame .qimage{position:relative;z-index:1;mix-blend-mode:multiply}.overlay{position:fixed;inset:0;background:#10293acc;display:none;place-items:center;padding:16px;z-index:20;overflow:auto}.modal{background:white;border-radius:18px;max-width:760px;width:min(760px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:22px;border:1px solid var(--line);box-shadow:0 20px 60px #0c263638;text-align:left}.heart-stage{position:relative;min-height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;text-align:center;background:linear-gradient(145deg,#effaff,#fff)}.big-heart{font-size:76px;animation:heartBeat .85s ease-in-out infinite}.float-heart{position:absolute;bottom:-45px;font-size:24px;animation:floatHeart 2.5s ease-out forwards;opacity:0;pointer-events:none}@keyframes heartBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}@keyframes floatHeart{0%{transform:translateY(0) scale(.7) rotate(-10deg);opacity:0}15%{opacity:1}100%{transform:translateY(-340px) scale(1.25) rotate(18deg);opacity:0}}.analysis-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.analysis-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:14px 0}.analysis-card{background:#f2faff;border:1px solid #d8edf8;border-radius:12px;padding:12px}.analysis-card b{display:block;font-size:22px;color:#145d88}.analysis-section{margin-top:18px}.review-row{border:1px solid #d9eaf4;border-radius:11px;margin:8px 0;overflow:hidden}.review-row summary{padding:11px;background:#f7fcff;cursor:pointer;font-weight:800}.review-body{padding:12px;font-size:14px;line-height:1.5}.review-body img{width:100%;height:auto;border:1px solid #d7eaf5;border-radius:8px;margin:6px 0}.status-good{color:#13804a}.status-bad{color:#bd3b3b}.status-skip{color:#667788}footer{text-align:center;color:#7894a6;font-size:11px;padding:12px}@media(max-width:760px){.controls .btn{flex:1}.question{padding:8px}.qimage{border-radius:7px}}@media(max-width:480px){.brand{gap:4px}.brand>div:last-child{gap:3px!important}.brand .logo{font-size:12px}.brand .logo small{font-size:8px;letter-spacing:1px}.brand .pill{font-size:11px;padding:8px 6px}.palette-toggle{font-size:11px;padding:8px 7px}.side{top:61px}}</style></head><body><header class="top"><div class="brand"><div class="logo">VS TEST NEET<small>ICE BLUE · BILINGUAL CBT</small></div><div style="display:flex;gap:6px;align-items:center"><button type="button" class="pill lang-switch" id="langBtn">HI + EN</button><span class="pill" id="timer">00:00:00</span><span class="pill" id="count">0 / ${N}</span><button type="button" class="pill" id="topSubmit" style="background:#159b69;color:#fff;border-color:#159b69">Submit ✓</button><button type="button" class="palette-toggle" id="paletteToggle" aria-expanded="false" aria-controls="paletteDrawer">☷ <span>Palette</span></button></div></div></header><div class="wrap"><main class="main"><section class="panel info"><div><b>${safeTitle}</b><div class="sub">${safeSubTitle} · ${safeSubject}</div></div><div><span class="tag">${N} Questions · ${Math.round(DURATION / 60)} Minutes</span><div class="progress"><span id="progress"></span></div></div></section><section class="panel" style="margin-top:12px"><div class="qhead"><div><span class="qnum" id="qtitle">Question 1 of ${N}</span><div class="sub" id="qsub">एक सही विकल्प चुनें / Choose one option</div></div><span class="tag" id="status">Not Answered</span></div><div class="question"><div id="hiBlock"><div class="langlabel">हिन्दी (HINDI)</div><div class="question-image-frame" id="hiImgWrap" style="display:none"><img id="hi" class="qimage" alt="Hindi question"></div><div id="hiText" class="qtext" style="display:none"></div></div><div id="enBlock" style="margin-top:10px"><div class="langlabel">ENGLISH</div><div class="question-image-frame" id="enImgWrap" style="display:none"><img id="en" class="qimage" alt="English question"></div><div id="enText" class="qtext" style="display:none"></div></div><div class="options" id="options"></div></div><div class="controls"><button class="btn" id="prev">← Previous</button><button class="btn warn" id="clear">Clear Response</button><button class="btn" id="mark">☆ Mark Review</button><button class="btn primary" id="next">Save & Next →</button><button class="btn green" id="submitMain">Submit Test ✓</button></div></section></main><aside class="panel side" id="paletteDrawer" aria-label="Question palette" hidden><div class="drawer-head"><h3>Question Palette</h3><button class="palette-close" id="paletteClose" type="button">✕</button></div><div class="sub">किसी भी प्रश्न पर जाने के लिए नंबर दबाएँ।</div><div class="legend"><span><i class="dot done"></i>Answered</span><span><i class="dot review"></i>Review</span><span><i class="dot"></i>Not answered</span></div><div class="palette" id="palette"></div><div class="controls" style="padding:13px 0 0"><button class="btn green" id="submit" style="width:100%">Submit Test</button></div></aside></div><footer>VS TEST NEET · ${safeTitle}</footer><div class="overlay" id="overlay"><div class="modal" id="modal"></div></div><script>const DATA=${JSON.stringify(compactQs)};const N=DATA.length,DURATION=${DURATION},MAX=${MAX},L=['1','2','3','4'],A={},M=new Set(),T={};let cur=0,sec=DURATION,done=false,lang='BOTH',timer;const started=Date.now(),$=x=>document.getElementById(x);function applyLanguage(){const item=DATA[cur]||{};const hasHi=Boolean(item.hiImg||item.qHi);const hasEn=Boolean(item.enImg||item.qEn);const showHi=(lang==='BOTH'||lang==='HI')&&hasHi||(lang==='EN'&&!hasEn&&hasHi);const showEn=(lang==='BOTH'||lang==='EN')&&hasEn||(lang==='HI'&&!hasHi&&hasEn);$('hiBlock').style.display=showHi?'block':'none';$('enBlock').style.display=showEn?'block':'none';$('langBtn').textContent=lang==='BOTH'?'HI + EN':lang==='HI'?'हिन्दी':'ENGLISH'}$('langBtn').onclick=()=>{lang=lang==='BOTH'?'HI':lang==='HI'?'EN':'BOTH';render()};function render(){const item=DATA[cur]||{},q=cur+1;$('qtitle').textContent='Question '+q+' of '+N;$('qsub').textContent=item.chapter||'एक सही विकल्प चुनें / Choose one option';if(item.hiImg){$('hiImgWrap').style.display='block';$('hi').src=item.hiImg;$('hiText').style.display='none'}else if(item.qHi){$('hiImgWrap').style.display='none';$('hiText').style.display='block';$('hiText').innerHTML=item.qHi}else{$('hiImgWrap').style.display='none';$('hiText').style.display='none'}if(item.enImg){$('enImgWrap').style.display='block';$('en').src=item.enImg;$('enText').style.display='none'}else if(item.qEn){$('enImgWrap').style.display='none';$('enText').style.display='block';$('enText').innerHTML=item.qEn}else{$('enImgWrap').style.display='none';$('enText').style.display='none'}applyLanguage();[cur+1,cur+2].forEach(nxIdx=>{const nx=DATA[nxIdx];if(nx){if(nx.hiImg&&nx.hiImg.charAt(0)==='/'){const im=new Image();im.src=nx.hiImg}if(nx.enImg&&nx.enImg.charAt(0)==='/'&&nx.enImg!==nx.hiImg){const im2=new Image();im2.src=nx.enImg}}});$('status').textContent=A[q]?'Answered':M.has(q)?'Review':'Not Answered';$('options').innerHTML=L.map((l,i)=>{const hiO=(item.optsHi&&item.optsHi[i])||'';const enO=(item.optsEn&&item.optsEn[i])||'';const isGeneric=(!hiO&&!enO)||(/^Option\\s*\\(?\\d/i.test(enO)&&(!hiO||/^विकल्प/i.test(hiO)));const labelText=isGeneric?'Option '+l:(lang==='HI'?(hiO||enO):lang==='EN'?(enO||hiO):(hiO&&enO&&hiO!==enO?hiO+' / '+enO:(hiO||enO)));return '<button class="opt '+(A[q]===i+1?'selected':'')+'" data-v="'+(i+1)+'"><span class="letter">'+l+'</span><span>'+labelText+'</span></button>'}).join('');document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{if(done)return;A[q]=+b.dataset.v;render()});$('prev').disabled=cur===0;$('next').textContent=cur===N-1?'Finish & Submit →':'Save & Next →';$('mark').textContent=M.has(q)?'★ Remove Review':'☆ Mark Review';let count=Object.keys(A).length;$('count').textContent=count+' / '+N;$('progress').style.width=(count/N*100)+'%';palette()}function palette(){$('palette').innerHTML=Array.from({length:N},(_,i)=>'<button class="pal '+(A[i+1]?'done':'')+' '+(M.has(i+1)?'review':'')+' '+(i===cur?'current':'')+'" data-i="'+i+'">'+(i+1)+'</button>').join('');document.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{if(done)return;cur=+b.dataset.i;render();closePalette()})}function closePalette(){$('paletteDrawer').hidden=true;$('paletteToggle').setAttribute('aria-expanded','false')}$('paletteToggle').onclick=()=>{let d=$('paletteDrawer');d.hidden=!d.hidden;$('paletteToggle').setAttribute('aria-expanded',String(!d.hidden))};$('paletteClose').onclick=closePalette;document.addEventListener('click',e=>{if(!$('paletteDrawer').hidden&&!$('paletteDrawer').contains(e.target)&&!$('paletteToggle').contains(e.target))closePalette()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closePalette()});function show(s){$('timer').textContent=[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':')};function modal(s){closePalette();$('modal').innerHTML=s;$('overlay').style.display='grid'}function hide(){$('overlay').style.display='none'}function submit(){if(done){result();return}modal('<h2>Submit Test?</h2><p>Attempted: <b>'+Object.keys(A).length+'</b> · Unanswered: <b>'+(N-Object.keys(A).length)+'</b></p><p>Marking Scheme: +4 correct, −1 incorrect, 0 unattempted.</p><div class="controls"><button class="btn" id="back">Go Back</button><button class="btn green" id="yes">Confirm Submit</button></div>');$('back').onclick=hide;$('yes').onclick=()=>{if(done)return;done=true;sec=Math.max(0,DURATION-Math.floor((Date.now()-started)/1000));show(sec);clearInterval(timer);heartCelebration()}}function heartCelebration(){modal('<div class="heart-stage" role="status"><div class="big-heart" aria-hidden="true">❤️</div><h2>Thank You for Completing Your Test ❤️</h2><p class="sub">Your scorecard & solutions are ready</p><button class="btn primary" id="skipHeart">Skip Animation · View Result</button></div>');const stage=document.querySelector('.heart-stage');['❤️','💗','💙','✨','💕','💙','✨','❤️'].forEach((h,i)=>{let e=document.createElement('span');e.className='float-heart';e.textContent=h;styleLeft=(7+i*12)+'%';e.style.left=styleLeft;e.style.animationDelay=(i*.1)+'s';stage.appendChild(e)});let finished=false;const finish=()=>{if(finished)return;finished=true;result()};$('skipHeart').onclick=finish;setTimeout(finish,1800)}function result(){let correct=0,wrong=0,blank=0;DATA.forEach((item,i)=>{const picked=A[i+1];if(!picked)blank++;else if(picked===item.ans)correct++;else wrong++});const score=correct*4-wrong;const attempted=correct+wrong;const acc=attempted?Math.round(correct/attempted*100):0;const spent=DURATION-sec;const fmt=t=>[Math.floor(t/3600),Math.floor(t%3600/60),t%60].map(n=>String(n).padStart(2,'0')).join(':');try{window.parent.postMessage({type:'VS_CBT_HTML_SUBMIT',score,maxMarks:MAX,correctCount:correct,wrongCount:wrong,unattemptedCount:blank,accuracy:acc,timeTakenSeconds:Math.max(1,spent),answers:A,questionTimes:T},'*')}catch(e){}let rows=DATA.map((item,i)=>{const picked=A[i+1];const cls=!picked?'status-skip':picked===item.ans?'status-good':'status-bad';const st=!picked?'Unattempted':picked===item.ans?'Correct (+4)':'Wrong (-1)';return '<details class="review-row" data-question="'+(i+1)+'"><summary class="'+cls+'">Q'+(i+1)+' · '+(picked?'Selected: ('+picked+')':'Unattempted')+' · Correct: ('+item.ans+') · '+st+'</summary><div class="review-body"><div class="lazy-question"></div>'+(item.expHi||item.expEn?'<p><b>Explanation:</b> '+(item.expHi||'')+' '+(item.expEn||'')+'</p>':'')+'</div></details>'}).join('');modal('<div class="analysis-head"><div><h2>'+${JSON.stringify(String(meta?.title || 'Test'))}+' · Result & Analysis</h2><div class="sub">Scorecard & Question-wise Review (+4 / −1)</div></div><div class="analysis-top-btns" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="close">Close Review</button></div></div><div class="analysis-grid"><div class="analysis-card"><b>'+score+' / '+MAX+'</b><span>Total Score</span></div><div class="analysis-card"><b>'+acc+'%</b><span>Accuracy</span></div><div class="analysis-card"><b class="status-good">'+correct+' (+'+(correct*4)+')</b><span>Correct Answers</span></div><div class="analysis-card"><b class="status-bad">'+wrong+' (-'+wrong+')</b><span>Wrong Answers</span></div><div class="analysis-card"><b>'+blank+'</b><span>Unattempted</span></div><div class="analysis-card"><b>'+fmt(spent)+'</b><span>Time Taken</span></div></div><section class="analysis-section"><h3>Question-wise Solutions & Answer Key</h3>'+rows+'</section>');document.querySelectorAll('details[data-question]').forEach(d=>d.addEventListener('toggle',()=>{let box=d.querySelector('.lazy-question');if(d.open){const it=DATA[+d.dataset.question-1]||{};box.innerHTML=(it.hiImg?'<img src="'+it.hiImg+'" alt="Hindi question">':it.qHi?'<div>'+it.qHi+'</div>':'')+(it.enImg?'<img src="'+it.enImg+'" alt="English question">':it.qEn?'<div style="margin-top:6px">'+it.qEn+'</div>':'')}else box.innerHTML=''}));$('close').onclick=()=>{hide();$('submit').textContent='Open Result & Analysis'}}$('prev').onclick=()=>{if(cur>0){cur--;render()}};$('next').onclick=()=>{if(cur<N-1){cur++;render()}else submit()};$('clear').onclick=()=>{delete A[cur+1];render()};$('mark').onclick=()=>{let n=cur+1;M.has(n)?M.delete(n):M.add(n);render()};$('submit').onclick=submit;if($('submitMain'))$('submitMain').onclick=submit;if($('topSubmit'))$('topSubmit').onclick=submit;show(sec);render();timer=setInterval(()=>{if(done)return;T[cur]=(T[cur]||0)+1;sec=Math.max(0,DURATION-Math.floor((Date.now()-started)/1000));show(sec);if(sec<=0){done=true;clearInterval(timer);heartCelebration()}},1000);</script></body></html>`;
}

function main() {
  if (!fs.existsSync(STORE_FILE)) {
    console.log('[vercelStaticExport] No portal_store.json found, skipping.');
    return;
  }

  const rawStore = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
  const bootstrapPayload = {
    version: rawStore.version || Date.now(),
    portalLogoUrl: rawStore.portalLogoUrl || '',
    globalAttachmentPdf: rawStore.globalAttachmentPdf || null,
    tests: Array.isArray(rawStore.tests) ? rawStore.tests : [],
    deletedTestIds: Array.isArray(rawStore.deletedTestIds) ? rawStore.deletedTestIds : [],
    deletedFolderIds: Array.isArray(rawStore.deletedFolderIds) ? rawStore.deletedFolderIds : [],
    deletedStudentIds: Array.isArray(rawStore.deletedStudentIds) ? rawStore.deletedStudentIds : [],
    deletedAttemptIds: Array.isArray(rawStore.deletedAttemptIds) ? rawStore.deletedAttemptIds : [],
    tickedStudentMap: rawStore.tickedStudentMap || {},
    folders: Array.isArray(rawStore.folders) ? rawStore.folders : [],
    students: Array.isArray(rawStore.students) ? rawStore.students.slice(0, 500) : [],
    attempts: Array.isArray(rawStore.attempts) ? rawStore.attempts.slice(0, 300) : [],
    notifications: Array.isArray(rawStore.notifications) ? rawStore.notifications.slice(0, 50) : [],
  };

  const bootstrapJson = JSON.stringify(bootstrapPayload);

  // 1. Always write bootstrap.json to public/static-store and dist/static-store (only ~1.2 MB)
  ensureDir(PUBLIC_STATIC_DIR);
  fs.writeFileSync(path.join(PUBLIC_STATIC_DIR, 'bootstrap.json'), bootstrapJson, 'utf-8');

  if (fs.existsSync(DIST_DIR)) {
    ensureDir(DIST_STATIC_DIR);
    fs.writeFileSync(path.join(DIST_STATIC_DIR, 'bootstrap.json'), bootstrapJson, 'utf-8');
  }

  // 2. When building outside AI Studio (e.g. on Vercel, Netlify, Cloudflare, or when EXPORT_STATIC_STORE=1),
  // export all test JSONs, standalone HTML papers, question diagrams, and PDFs into dist/static-store/!
  const isFullStaticExport =
    !process.env.APPLET_ID ||
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.NETLIFY) ||
    Boolean(process.env.CF_PAGES) ||
    process.env.EXPORT_STATIC_STORE === '1';

  if (!isFullStaticExport || !fs.existsSync(DIST_DIR)) {
    console.log(
      `[vercelStaticExport] Exported bootstrap.json (${bootstrapPayload.tests.length} tests, ${bootstrapPayload.folders.length} folders).`
    );
    return;
  }

  const distTestsDir = path.join(DIST_STATIC_DIR, 'test');
  const distPapersDir = path.join(DIST_STATIC_DIR, 'paper');
  const distQimgDir = path.join(DIST_STATIC_DIR, 'qimg');
  const distPdfsDir = path.join(DIST_STATIC_DIR, 'pdfs');
  ensureDir(distTestsDir);
  ensureDir(distPapersDir);
  ensureDir(distQimgDir);
  ensureDir(distPdfsDir);

  let exportedCount = 0;
  for (const testMeta of bootstrapPayload.tests) {
    if (!testMeta || !testMeta.id) continue;
    const safeId = String(testMeta.id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    const parsed = readTestFileSync(safeId);
    if (!parsed) continue;

    const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const rawHtml = typeof parsed.rawHtml === 'string' ? parsed.rawHtml : '';
    const hasRawHtml = rawHtml.trim().length > 200;

    // Export binary question diagrams for fast static CDN loading
    const testQimgDir = path.join(distQimgDir, safeId);
    if (!hasRawHtml && rawQuestions.length > 0) {
      ensureDir(testQimgDir);
      rawQuestions.forEach((q, idx) => {
        if (!q || typeof q !== 'object') return;
        const imgs = Array.isArray(q.imageUrls) ? q.imageUrls : [];
        const hiDataUrl =
          ensureImageDataUrlServer(q.imageHi) ||
          ensureImageDataUrlServer(imgs[0]) ||
          ensureImageDataUrlServer(q.imageUrl) ||
          ensureImageDataUrlServer(q.questionHi);
        const enDataUrl =
          ensureImageDataUrlServer(q.imageEn) ||
          ensureImageDataUrlServer(imgs[1]) ||
          ensureImageDataUrlServer(q.questionEn) ||
          hiDataUrl;

        const hiBuf = decodeDataUrlToBuffer(hiDataUrl);
        if (hiBuf) {
          fs.writeFileSync(path.join(testQimgDir, `${idx}_hi.png`), hiBuf);
        }
        const enBuf = decodeDataUrlToBuffer(enDataUrl);
        if (enBuf) {
          fs.writeFileSync(path.join(testQimgDir, `${idx}_en.png`), enBuf);
        }
      });
    }

    // Export compact test metadata + questions JSON (<100KB)
    const compactQuestions = rawQuestions.map((q, idx) => {
      if (!q || typeof q !== 'object') return q;
      const imgs = Array.isArray(q.imageUrls) ? q.imageUrls : [];
      const hasInlineHi = Boolean(
        ensureImageDataUrlServer(q.imageHi) ||
          ensureImageDataUrlServer(imgs[0]) ||
          ensureImageDataUrlServer(q.imageUrl) ||
          ensureImageDataUrlServer(q.questionHi)
      );
      const hasInlineEn = Boolean(
        ensureImageDataUrlServer(q.imageEn) ||
          ensureImageDataUrlServer(imgs[1]) ||
          ensureImageDataUrlServer(q.questionEn)
      );
      const hiUrl = hasInlineHi ? `/static-store/qimg/${encodeURIComponent(safeId)}/${idx}_hi.png` : '';
      const enUrl = hasInlineEn
        ? `/static-store/qimg/${encodeURIComponent(safeId)}/${idx}_en.png`
        : hiUrl;
      return {
        ...q,
        imageUrl: hasRawHtml ? undefined : hiUrl || enUrl || undefined,
        imageHi: hasRawHtml ? undefined : hiUrl || undefined,
        imageEn: hasRawHtml ? undefined : enUrl || undefined,
        imageUrls: hasRawHtml ? undefined : hiUrl ? [hiUrl, enUrl || hiUrl] : undefined,
        questionHi:
          typeof q.questionHi === 'string' && q.questionHi.length > 1500 ? '' : q.questionHi,
        questionEn:
          typeof q.questionEn === 'string' && q.questionEn.length > 1500 ? '' : q.questionEn,
      };
    });

    fs.writeFileSync(
      path.join(distTestsDir, `${safeId}.json`),
      JSON.stringify({
        meta: parsed.meta || testMeta,
        questions: compactQuestions,
        rawHtml: '',
        hasRawHtml: true,
      }),
      'utf-8'
    );

    // Export standalone HTML paper
    const durMin = Number(testMeta.durationMinutes || parsed.meta?.durationMinutes || 180);
    const durSec = (durMin <= 6 ? durMin * 60 : Math.max(60, durMin)) * 60;
    const rawPaper = hasRawHtml
      ? rawHtml
      : buildStandaloneCbtHtmlForStatic(parsed.meta || testMeta, rawQuestions);
    const patchedPaper = patchHtmlForPortalIframe(rawPaper, {
      testId: safeId,
      title: String(testMeta.title || parsed.meta?.title || 'VS Test'),
      totalQuestions: Number(testMeta.totalQuestions || rawQuestions.length || 90),
      durationSeconds: durSec,
    });
    fs.writeFileSync(path.join(distPapersDir, `${safeId}.html`), patchedPaper, 'utf-8');
    exportedCount++;
  }

  // Export PDFs if any exist
  if (fs.existsSync(PDFS_DIR)) {
    for (const file of fs.readdirSync(PDFS_DIR)) {
      if (file.endsWith('.pdf')) {
        fs.copyFileSync(path.join(PDFS_DIR, file), path.join(distPdfsDir, file));
      }
    }
  }

  console.log(
    `[vercelStaticExport] Full static export complete: ${exportedCount} tests exported to dist/static-store/`
  );
}

main();
