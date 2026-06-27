const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const state = {
  img: null,
  exif: {},
  ratio: { w: 3, h: 4, pw: 900, ph: 1200 },
  cropX: 50, cropY: 50,
  frameColor: '#ffffff',
  framePadding: 40, barHeight: 80,
  textColor: '#333333',
  fontFamily: 'DM Sans', fontWeight: null,
  comment: '',
  logo: null, logoPos: 'bar-right', logoSize: 60, logoOpacity: 0.8,
  exportFormat: 'jpeg', jpegQuality: 0.92,
  letterSpacing: 0, lineSpacing: 6, fontScaleTitle: 100, fontScaleDetail: 100, textAlign: 'center', textVAlign: 'middle', textOffsetY: 0,
};

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.classList.add('hidden'), 300); }, 2500);
}

// ---- Drop Zone ----
const dropZone = $('#dropZone');
const fileInput = $('#fileInput');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', e => { if (e.target.files[0]) loadImage(e.target.files[0]); });

async function loadImage(file) {
  await readExif(file);

  // Detect file type
  const name = file.name.toLowerCase();
  const type = file.type || '';
  const isHeic = name.endsWith('.heic') || name.endsWith('.heif') || type === 'image/heic' || type === 'image/heif';
  const isTiff = name.endsWith('.tiff') || name.endsWith('.tif') || type === 'image/tiff';

  // TIFF: decode with UTIF.js
  if (isTiff) {
    toast('TIFF変換中...');
    try {
      const buf = await file.arrayBuffer();
      const ifds = UTIF.decode(buf);
      UTIF.decodeImage(buf, ifds[0]);
      const rgba = UTIF.toRGBA8(ifds[0]);
      const w = ifds[0].width, h = ifds[0].height;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer), w, h);
      ctx.putImageData(imageData, 0, 0);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
      const img = await loadImg(URL.createObjectURL(blob));
      state.img = img;
      showEditor();
      return;
    } catch (e) {
      console.error('TIFF decode failed:', e);
      toast('TIFF変換に失敗しました');
      return;
    }
  }

  // Try direct load (JPEG/PNG/WebP)
  if (!isHeic) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url);
      state.img = img;
      showEditor();
      return;
    } catch (_) { URL.revokeObjectURL(url); }
  }

  // HEIC conversion via libheif.js
  toast('HEIC変換中...');
  try {
    let mod;
    try { mod = await libheif(); } catch(_) {}
    if (!mod || !mod.HeifDecoder) {
      const ret = libheif();
      mod = (ret && ret.then) ? await ret : ret;
    }
    if (!mod || !mod.HeifDecoder) throw new Error('libheif init failed');

    const buf = await file.arrayBuffer();
    const decoder = new mod.HeifDecoder();
    const images = decoder.decode(new Uint8Array(buf));
    if (!images || !images.length) throw new Error('No images decoded');

    const image = images[0];
    const w = image.get_width(), h = image.get_height();
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(w, h);

    await new Promise((resolve, reject) => {
      image.display(imageData, r => r ? resolve() : reject(new Error('display failed')));
    });
    ctx.putImageData(imageData, 0, 0);

    const jpegBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
    const img = await loadImg(URL.createObjectURL(jpegBlob));
    state.img = img;
    showEditor();
    toast('HEIC変換完了');
  } catch (e) {
    console.error('HEIC conversion failed:', e);
    toast('HEIC変換に失敗しました');
  }
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function showEditor() {
  dropZone.classList.add('hidden');
  $('#editor').classList.remove('hidden');
  $('#cancelBtn').classList.remove('hidden');
  render();
}

// ---- Cancel ----
$('#cancelBtn').addEventListener('click', () => {
  state.img = null; state.exif = {}; state.logo = null; state.comment = '';
  ['exifCamera','exifLens','exifFocal','exifFNumber','exifShutter','exifISO','commentText'].forEach(id => $('#'+id).value = '');
  const d = $('#exifDisplay'); d.textContent = ''; const s = document.createElement('span'); s.className = 'dim'; s.textContent = '画像読込で自動取得'; d.appendChild(s);
  $('#editor').classList.add('hidden'); $('#cancelBtn').classList.add('hidden'); dropZone.classList.remove('hidden'); fileInput.value = '';
});

// ---- Exif ----
async function readExif(file) {
  try {
    if (typeof exifr === 'undefined') { toast('exifr未ロード'); return; }
    let data;
    try { data = await exifr.parse(file, true); } catch(_) {}
    if (!data) {
      try { data = await exifr.parse(file, ['Make','Model','LensModel','FocalLength','FNumber','ExposureTime','ISO','ISOSpeedRatings','FocalLengthIn35mmFormat']); } catch(_) {}
    }
    if (!data) {
      try { data = await exifr.parse(file); } catch(_) {}
    }
    if (!data) return;
    const make = (data.Make || '').trim();
    const model = (data.Model || '').trim();
    const camera = (model && make && model.toLowerCase().startsWith(make.toLowerCase())) ? model : [make, model].filter(Boolean).join(' ').replace(/\s+/g, ' ');
    const lens = data.LensModel || '';
    const focal = data.FocalLengthIn35mmFormat || data.FocalLength;
    const focalStr = focal ? `${Math.round(focal)}mm` : '';
    const fNum = data.FNumber ? `f/${data.FNumber}` : '';
    const ss = data.ExposureTime ? (data.ExposureTime >= 1 ? `${data.ExposureTime}s` : `1/${Math.round(1/data.ExposureTime)}s`) : '';
    let iso = data.ISO || data.ISOSpeedRatings || '';
    if (Array.isArray(iso)) iso = iso[0] || '';
    const isoStr = iso ? `ISO${iso}` : '';

    state.exif = { camera, lens, focal: focalStr, fNumber: fNum, shutter: ss, iso: isoStr };
    $('#exifCamera').value = camera; $('#exifLens').value = lens; $('#exifFocal').value = focalStr;
    $('#exifFNumber').value = fNum; $('#exifShutter').value = ss; $('#exifISO').value = isoStr;

    const display = $('#exifDisplay'); display.textContent = '';
    const b = document.createElement('strong'); b.textContent = camera; display.appendChild(b);
    if (lens) display.appendChild(document.createTextNode(' — ' + lens));
    display.appendChild(document.createElement('br'));
    display.appendChild(document.createTextNode([focalStr, fNum, ss, isoStr].filter(Boolean).join('  ')));
  } catch (e) { console.warn('Exif read failed:', e); toast('Exif: ' + (e.message || String(e))); }
}

// ---- Accordion ----
$$('.panel__header').forEach(h => h.addEventListener('click', () => { const p = h.closest('.panel'); p.dataset.open = p.dataset.open === 'true' ? 'false' : 'true'; }));

// ---- Presets ----
$$('.preset').forEach(btn => btn.addEventListener('click', () => {
  $$('.preset').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  const [rw,rh] = btn.dataset.ratio.split(':').map(Number);
  state.ratio = { w:rw, h:rh, pw:+btn.dataset.w, ph:+btn.dataset.h }; render();
}));

// ---- Crop ----
$('#cropX').addEventListener('input', e => { state.cropX = +e.target.value; $('#cropXVal').textContent = e.target.value; render(); });
$('#cropY').addEventListener('input', e => { state.cropY = +e.target.value; $('#cropYVal').textContent = e.target.value; render(); });

// ---- Frame ----
$$('.swatch').forEach(btn => btn.addEventListener('click', () => {
  $$('.swatch').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  state.frameColor = btn.dataset.color; autoTextColor(); render();
}));
$('#customColor').addEventListener('input', e => { $$('.swatch').forEach(b => b.classList.remove('active')); state.frameColor = e.target.value; autoTextColor(); render(); });
$('#framePadding').addEventListener('input', e => { state.framePadding = +e.target.value; $('#framePaddingVal').textContent = e.target.value; render(); });
$('#barHeight').addEventListener('input', e => { state.barHeight = +e.target.value; $('#barHeightVal').textContent = e.target.value; render(); });

function autoTextColor() {
  const r = parseInt(state.frameColor.slice(1,3),16), g = parseInt(state.frameColor.slice(3,5),16), b = parseInt(state.frameColor.slice(5,7),16);
  state.textColor = (0.299*r + 0.587*g + 0.114*b) / 255 > 0.5 ? '#333333' : '#eeeeee';
  $('#textColor').value = state.textColor;
}
$('#textColor').addEventListener('input', e => { state.textColor = e.target.value; render(); });

// ---- Letter Spacing ----
$('#fontScaleTitle').addEventListener('input', e => { state.fontScaleTitle = +e.target.value; $('#fontScaleTitleVal').textContent = e.target.value + '%'; render(); });
$('#fontScaleDetail').addEventListener('input', e => { state.fontScaleDetail = +e.target.value; $('#fontScaleDetailVal').textContent = e.target.value + '%'; render(); });
$('#letterSpacing').addEventListener('input', e => { state.letterSpacing = +e.target.value; $('#letterSpacingVal').textContent = e.target.value; render(); });
$('#lineSpacing').addEventListener('input', e => { state.lineSpacing = +e.target.value; $('#lineSpacingVal').textContent = e.target.value; render(); });

// ---- Text Align ----
$$('.align-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.align-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  state.textAlign = btn.dataset.align; render();
}));
$('#textOffsetY').addEventListener('input', e => { state.textOffsetY = +e.target.value; $('#textOffsetYVal').textContent = e.target.value; render(); });
$$('.valign-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.valign-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
  state.textVAlign = btn.dataset.valign; render();
}));

// ---- Exif manual ----
const exifMap = {camera:'exifCamera', lens:'exifLens', focal:'exifFocal', fNumber:'exifFNumber', shutter:'exifShutter', iso:'exifISO'};
Object.entries(exifMap).forEach(([key,id]) => $('#'+id).addEventListener('input', e => { state.exif[key] = e.target.value; render(); }));

// ---- Comment ----
$('#commentText').addEventListener('input', e => { state.comment = e.target.value; render(); });

// ---- Font ----
$('#fontSelect').addEventListener('change', async e => {
  const opt = e.target.selectedOptions[0];
  state.fontFamily = e.target.value;
  state.fontWeight = opt && opt.dataset.weight ? opt.dataset.weight : null;
  const w = state.fontWeight || '400';
  try { await document.fonts.load(`${w} 16px "${state.fontFamily}"`); await document.fonts.load(`700 16px "${state.fontFamily}"`); } catch(_) {}
  render();
});
let fontTimer;
$('#fontSearch').addEventListener('input', e => {
  clearTimeout(fontTimer); const q = e.target.value.trim();
  if (q.length < 2) { $('#fontResults').classList.add('hidden'); return; }
  fontTimer = setTimeout(() => searchFonts(q), 400);
});
async function searchFonts(query) {
  try {
    const res = await fetch('https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity');
    const data = await res.json();
    const matches = data.items.filter(f => f.family.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
    const c = $('#fontResults'); c.textContent = '';
    matches.forEach(f => { const d = document.createElement('div'); d.className = 'font-result-item'; d.textContent = f.family; d.addEventListener('click', () => addFont(f.family)); c.appendChild(d); });
    c.classList.toggle('hidden', !matches.length);
  } catch (e) { console.warn('Font search failed:', e); }
}
function addFont(family) {
  const enc = family.replace(/\s+/g, '+');
  if (!document.querySelector(`link[data-font="${family}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${enc}:wght@400;700&display=swap`; l.dataset.font = family; document.head.appendChild(l); }
  const sel = $('#fontSelect');
  if (![...sel.options].some(o => o.value === family)) { const opt = document.createElement('option'); opt.value = family; opt.textContent = family + ' ✦'; sel.appendChild(opt); }
  sel.value = family; state.fontFamily = family; $('#fontResults').classList.add('hidden'); $('#fontSearch').value = '';
  document.fonts.load(`400 16px "${family}"`).then(() => document.fonts.load(`700 16px "${family}"`)).then(render).catch(render);
}

// ---- Logo ----
$('#logoInput').closest('label').addEventListener('click', () => $('#logoInput').click());
$('#logoInput').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { const img = new Image(); img.onload = () => { state.logo = img; render(); }; img.src = ev.target.result; }; r.readAsDataURL(f); });
$('#logoPosition').addEventListener('change', e => { state.logoPos = e.target.value; render(); });
$('#logoSize').addEventListener('input', e => { state.logoSize = +e.target.value; $('#logoSizeVal').textContent = e.target.value; render(); });
$('#logoOpacity').addEventListener('input', e => { state.logoOpacity = +e.target.value/100; $('#logoOpacityVal').textContent = e.target.value + '%'; render(); });
$('#logoClear').addEventListener('click', () => { state.logo = null; $('#logoInput').value = ''; render(); });

// ---- Export ----
$$('.fmt').forEach(btn => btn.addEventListener('click', () => { $$('.fmt').forEach(b => b.classList.remove('active')); btn.classList.add('active'); state.exportFormat = btn.dataset.fmt; }));
$('#jpegQuality').addEventListener('input', e => { state.jpegQuality = +e.target.value/100; $('#jpegQualityVal').textContent = e.target.value + '%'; });

// ---- Render ----
let raf;
function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(_render); }

function _render() {
  if (!state.img) return;
  const canvas = $('#previewCanvas'), ctx = canvas.getContext('2d');
  const { pw, ph } = state.ratio, pad = state.framePadding, bar = state.barHeight;
  const W = pw + pad*2, H = ph + pad*2 + bar;
  canvas.width = W; canvas.height = H;

  ctx.fillStyle = state.frameColor; ctx.fillRect(0, 0, W, H);

  const src = state.img, srcAR = src.width/src.height, dstAR = pw/ph;
  let sx,sy,sw,sh;
  if (srcAR > dstAR) { sh = src.height; sw = sh*dstAR; sy = 0; sx = (src.width-sw)*(state.cropX/100); }
  else { sw = src.width; sh = sw/dstAR; sx = 0; sy = (src.height-sh)*(state.cropY/100); }
  ctx.drawImage(src, sx, sy, sw, sh, pad, pad, pw, ph);

  if (state.logo && (state.logoPos==='photo-br'||state.logoPos==='photo-bl')) drawLogo(ctx, pad, pad, pw, ph);

  const barY = pad+ph+pad, e = state.exif;
  const line1 = [e.camera, e.lens].filter(Boolean).join('   ');
  const line2 = [e.focal, e.fNumber, e.shutter, e.iso].filter(Boolean).join('  ');
  const scaleT = state.fontScaleTitle / 100, scaleD = state.fontScaleDetail / 100;
  const s1 = Math.max(14, Math.min(24, pw/40)) * scaleT, s2 = Math.max(11, Math.min(16, pw/55)) * scaleD;
  const sc = Math.max(10,Math.min(14,pw/60)) * scaleD;

  const fw = state.fontWeight || '400';
  const fwBold = state.fontWeight ? state.fontWeight : '700';
  const textEntries = [];
  if (line1) textEntries.push({ text: line1, size: s1, weight: fwBold });
  if (line2) textEntries.push({ text: line2, size: s2, weight: fw });
  if (state.comment) textEntries.push({ text: state.comment, size: sc, weight: fw });

  if (textEntries.length) {
    const lineGap = state.lineSpacing;
    const totalTextH = textEntries.reduce((s,t) => s + t.size, 0) + lineGap * (textEntries.length - 1);
    const vAlign = state.textVAlign || 'middle';
    const vPad = 4;
    const textAreaTop = pad + ph;
    const textAreaH = pad + bar;
    let startY;
    if (vAlign === 'top') startY = textAreaTop + vPad;
    else if (vAlign === 'bottom') startY = textAreaTop + textAreaH - totalTextH - vPad;
    else startY = textAreaTop + (textAreaH - totalTextH) / 2;
    startY += state.textOffsetY;
    startY = Math.max(textAreaTop, Math.min(startY, textAreaTop + textAreaH - totalTextH));

    const hAlign = state.textAlign || 'center';
    ctx.textAlign = hAlign;
    let textX;
    if (hAlign === 'left') textX = pad + 16;
    else if (hAlign === 'right') textX = W - pad - 16;
    else textX = W / 2;

    ctx.fillStyle = state.textColor;
    ctx.textBaseline = 'top';
    let curY = startY;
    for (const t of textEntries) {
      ctx.font = `${t.weight} ${t.size}px "${state.fontFamily}", sans-serif`;
      ctx.letterSpacing = `${state.letterSpacing}px`;
      ctx.fillText(t.text, textX, curY, W - pad * 4);
      curY += t.size + lineGap;
    }
    ctx.letterSpacing = '0px';
  }

  if (state.logo && (state.logoPos==='bar-right'||state.logoPos==='bar-left')) drawLogo(ctx, pad, barY, pw, bar);
}

function drawLogo(ctx, ax, ay, aw, ah) {
  if (!state.logo) return;
  const ar = state.logo.width/state.logo.height, lh = state.logoSize, lw = lh*ar, m = 12;
  const lx = state.logoPos.includes('right') ? ax+aw-lw-m : ax+m;
  ctx.save(); ctx.globalAlpha = state.logoOpacity; ctx.drawImage(state.logo, lx, ay+ah-lh-m, lw, lh); ctx.restore();
}

// ---- Download ----
$('#downloadBtn').addEventListener('click', () => { if (!state.img) return; renderToBlob().then(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `x-image-frame_${state.ratio.pw}x${state.ratio.ph}.${state.exportFormat}`; a.click(); toast('ダウンロード完了'); }); });

// ---- Clipboard ----
$('#clipboardBtn').addEventListener('click', async () => {
  if (!state.img) return;
  try { const b = await renderToBlob('image/png'); await navigator.clipboard.write([new ClipboardItem({'image/png':b})]); toast('クリップボードにコピーしました'); }
  catch (e) { toast('コピーに失敗しました'); }
});

// ---- Post to X ----
$('#postXBtn').addEventListener('click', async () => {
  if (!state.img) return;
  try {
    const b = await renderToBlob('image/png');
    await navigator.clipboard.write([new ClipboardItem({'image/png': b})]);
    window.open('https://x.com/compose/post', '_blank');
    toast('📋 画像をコピーしました — Xの投稿欄で ⌘+V で貼り付け');
  } catch (e) {
    // フォールバック: ダウンロード方式
    try {
      const b = await renderToBlob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `x-image-frame_${state.ratio.pw}x${state.ratio.ph}.${state.exportFormat}`;
      a.click();
      setTimeout(() => window.open('https://x.com/compose/post', '_blank'), 500);
      toast('画像を保存しました — Xの📷ボタンからアップロード');
    } catch (_) { toast('エラーが発生しました'); }
  }
});

function renderToBlob(forceMime) {
  return new Promise(resolve => {
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    const { pw,ph } = state.ratio, pad = state.framePadding, bar = state.barHeight;
    const W = pw+pad*2, H = ph+pad*2+bar; c.width = W; c.height = H;
    ctx.fillStyle = state.frameColor; ctx.fillRect(0,0,W,H);
    const src = state.img, srcAR = src.width/src.height, dstAR = pw/ph;
    let sx,sy,sw,sh;
    if (srcAR>dstAR){sh=src.height;sw=sh*dstAR;sy=0;sx=(src.width-sw)*(state.cropX/100);}
    else{sw=src.width;sh=sw/dstAR;sx=0;sy=(src.height-sh)*(state.cropY/100);}
    ctx.drawImage(src,sx,sy,sw,sh,pad,pad,pw,ph);
    if(state.logo&&(state.logoPos==='photo-br'||state.logoPos==='photo-bl')){const ar=state.logo.width/state.logo.height,lh=state.logoSize,lw=lh*ar,m=12;const lx=state.logoPos.includes('right')?pad+pw-lw-m:pad+m;ctx.save();ctx.globalAlpha=state.logoOpacity;ctx.drawImage(state.logo,lx,pad+ph-lh-m,lw,lh);ctx.restore();}
    const barY=pad+ph+pad,e=state.exif,line1=[e.camera,e.lens].filter(Boolean).join('   '),line2=[e.focal,e.fNumber,e.shutter,e.iso].filter(Boolean).join('  ');
    const scaleT=state.fontScaleTitle/100,scaleD=state.fontScaleDetail/100;
    const s1=Math.max(14,Math.min(24,pw/40))*scaleT,s2=Math.max(11,Math.min(16,pw/55))*scaleD,sc=Math.max(10,Math.min(14,pw/60))*scaleD;
    const fw=state.fontWeight||'400',fwBold=state.fontWeight?state.fontWeight:'700';
    const textEntries=[];
    if(line1)textEntries.push({text:line1,size:s1,weight:fwBold});
    if(line2)textEntries.push({text:line2,size:s2,weight:fw});
    if(state.comment)textEntries.push({text:state.comment,size:sc,weight:fw});
    if(textEntries.length){
      const lineGap=state.lineSpacing,totalTextH=textEntries.reduce((s,t)=>s+t.size,0)+lineGap*(textEntries.length-1);
      const vAlign=state.textVAlign||'middle';const vPad=4;
      const textAreaTop=pad+ph,textAreaH=pad+bar;
      let startY;
      if(vAlign==='top')startY=textAreaTop+vPad;
      else if(vAlign==='bottom')startY=textAreaTop+textAreaH-totalTextH-vPad;
      else startY=textAreaTop+(textAreaH-totalTextH)/2;
      startY+=state.textOffsetY;
      startY=Math.max(textAreaTop,Math.min(startY,textAreaTop+textAreaH-totalTextH));
      const hAlign=state.textAlign||'center';
      ctx.textAlign=hAlign;
      let textX;if(hAlign==='left')textX=pad+16;else if(hAlign==='right')textX=W-pad-16;else textX=W/2;
      ctx.fillStyle=state.textColor;ctx.textBaseline='top';
      let curY=startY;
      for(const t of textEntries){ctx.font=`${t.weight} ${t.size}px "${state.fontFamily}", sans-serif`;ctx.letterSpacing=`${state.letterSpacing}px`;ctx.fillText(t.text,textX,curY,W-pad*4);curY+=t.size+lineGap;}
      ctx.letterSpacing='0px';
    }
    if(state.logo&&(state.logoPos==='bar-right'||state.logoPos==='bar-left')){const ar=state.logo.width/state.logo.height,lh=state.logoSize,lw=lh*ar,m=12;const lx=state.logoPos.includes('right')?pad+pw-lw-m:pad+m;ctx.save();ctx.globalAlpha=state.logoOpacity;ctx.drawImage(state.logo,lx,barY+bar-lh-m,lw,lh);ctx.restore();}
    const mime=forceMime||(state.exportFormat==='png'?'image/png':'image/jpeg');
    c.toBlob(b=>resolve(b),mime,mime==='image/jpeg'?state.jpegQuality:undefined);
  });
}
