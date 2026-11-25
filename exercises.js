/* Hỏi – Đáp và Nghe – Chọn đáp án. Dùng chung tiện ích từ app.js (window.FC). */
(function () {
  const FC = window.FC;
  if (!FC) return;
  const { $, sb, BUCKET, imgUrl, beep, shuffled, setStatus, shrink, extOf, speakNow } = FC;

  const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const ICON_BAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

  let ex = [], session = null, loadErr = '';
  const visible = id => !$(id).hidden;
  const shake = el => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
  const msg = (id, t, kind) => { const m = $(id); m.textContent = t || ''; m.className = 'spell-msg ' + (kind || ''); };

  /* ---------- Phát bài nghe: file thật nếu có, không thì giọng máy ---------- */
  function stopAllAudio() {
    document.querySelectorAll('audio.ex-audio').forEach(a => { try { a.pause(); } catch (e) {} });
    if (window.speechSynthesis) speechSynthesis.cancel();
  }
  function playEx(e, audioEl, fromStart = true) {
    if (!e) return;
    if (e.audioUrl) {
      if (window.speechSynthesis) speechSynthesis.cancel();
      if (audioEl.getAttribute('src') !== e.audioUrl) audioEl.setAttribute('src', e.audioUrl);
      if (fromStart) audioEl.currentTime = 0;
      const p = audioEl.play(); if (p && p.catch) p.catch(() => {});   // trình duyệt chặn tự phát thì HS bấm ▶
    } else speakNow(e.audio_text);
  }
  function setupAudio(audioEl, e) {
    audioEl.hidden = !e.audioUrl;
    if (e.audioUrl) { if (audioEl.getAttribute('src') !== e.audioUrl) { audioEl.setAttribute('src', e.audioUrl); } }
    else { audioEl.removeAttribute('src'); try { audioEl.load(); } catch (x) {} }
  }

  /* ---------- So sánh câu: bỏ dấu câu, hoa/thường, viết tắt ---------- */
  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/\bcan't\b/g, 'can not').replace(/\bcannot\b/g, 'can not').replace(/\bwon't\b/g, 'will not')
      .replace(/n't\b/g, ' not').replace(/'m\b/g, ' am').replace(/'re\b/g, ' are').replace(/'s\b/g, ' is')
      .replace(/'ll\b/g, ' will').replace(/'ve\b/g, ' have').replace(/'d\b/g, ' would')
      .replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }
  function splitSentence(s) {
    const words = (s || '').trim().split(/\s+/).filter(Boolean);
    let end = '';
    if (words.length) {
      const m = words[words.length - 1].match(/^(.*?)([.?!]+)$/);
      if (m && m[1]) { words[words.length - 1] = m[1]; end = m[2]; }
    }
    return { words, end };
  }
  const eqW = (a, b) => norm(a) === norm(b);

  /* ---------- Tải dữ liệu + realtime ---------- */
  let loading = null;
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      let data = [];
      for (let from = 0; ; from += 1000) {
        const r = await sb.from('exercises').select('*').order('sort_order', { ascending: true }).range(from, from + 999);
        if (r.error) { loadErr = r.error.message; break; }
        loadErr = '';
        data = data.concat(r.data);
        if (r.data.length < 1000) break;
      }
      ex = data.map(e => ({ ...e, url: e.image_path ? imgUrl(e.image_path) : '', audioUrl: e.audio_path ? imgUrl(e.audio_path) : '', options: Array.isArray(e.options) ? e.options : [] }));
      fillTopics();
      qaSync(); lsSync(); fdSync(); renderExList();
    })();
    try { await loading; } finally { loading = null; }
  }
  let t0 = null;
  sb.channel('ex-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'exercises' }, () => { clearTimeout(t0); t0 = setTimeout(load, 300); })
    .subscribe();
  load();

  function fillTopics() {
    for (const [id, kind] of [['qaTopic', 'qa'], ['lsTopic', 'listen'], ['fdTopic', 'fill']]) {
      const sel = $(id), cur = sel.value;
      const ts = [...new Set(ex.filter(e => e.kind === kind).map(e => (e.topic || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
      sel.length = 1;
      ts.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
      sel.value = ts.includes(cur) ? cur : '';
    }
  }
  function syncDeck(st, kind, topic) {
    const ids = ex.filter(e => e.kind === kind && (!topic || (e.topic || '').trim() === topic)).map(e => e.id);
    const keep = st.deck[st.idx];
    const old = st.deck.filter(id => ids.includes(id));
    st.deck = old.concat(shuffled(ids.filter(id => !old.includes(id))));
    const k = st.deck.indexOf(keep);
    st.idx = k >= 0 ? k : Math.min(st.idx, Math.max(0, st.deck.length - 1));
    if (k < 0) st.forId = null;
  }
  function emptyState(boxId, emptyId, counterId, has, text) {
    $(boxId).hidden = !has; $(emptyId).hidden = has;
    if (!has) {
      $(emptyId).querySelector('strong').textContent = loadErr ? 'Chưa tạo bảng bài tập' : 'Chưa có bài nào';
      $(emptyId).querySelector('span').textContent = loadErr ? 'Chạy file update-bai-tap.sql trong Supabase (xem hướng dẫn).' : text;
      $(counterId).textContent = '0 / 0';
    }
  }

  /* ======================= HỎI – ĐÁP ======================= */
  const qa = { deck: [], idx: 0, forId: null, done: false, timer: null, tiles: [], placed: [], hinted: new Set(), bad: new Set(), parts: null, sample: false };
  const qaCur = () => ex.find(e => e.id === qa.deck[qa.idx]);
  function qaSync() { syncDeck(qa, 'qa', $('qaTopic').value); qaRender(); }
  function qaNew(e) {
    qa.forId = e.id; qa.done = false; qa.sample = false; clearTimeout(qa.timer);
    qa.parts = splitSentence(e.answer);
    qa.placed = []; qa.hinted = new Set(); qa.bad = new Set();
    const idxs = qa.parts.words.map((_, i) => i);
    let t = idxs;
    for (let n = 0; n < 10; n++) {
      t = shuffled(idxs);
      if (t.map(i => norm(qa.parts.words[i])).join(' ') !== qa.parts.words.map(norm).join(' ') || idxs.length < 2) break;
    }
    qa.tiles = t;
    $('qaText').value = ''; $('qaText').classList.remove('bad', 'ok');
    msg('qaMsg', '');
  }
  function qaRender() {
    const has = qa.deck.length > 0;
    emptyState('qaBox', 'qaEmpty', 'qaCounter', has, 'Vào tab “Tạo thẻ” để tạo bài Hỏi – Đáp.');
    if (!has) return;
    const e = qaCur();
    if (qa.forId !== e.id) qaNew(e);
    $('qaCounter').textContent = (qa.idx + 1) + ' / ' + qa.deck.length;
    const img = $('qaImg'); img.hidden = !e.url; if (e.url && img.getAttribute('src') !== e.url) img.setAttribute('src', e.url);
    const askQ = e.direction === 'question';
    $('qaLabel').textContent = askQ ? 'Câu trả lời' : 'Câu hỏi';
    $('qaPrompt').textContent = e.prompt || '';
    $('qaSay').hidden = !e.prompt;
    $('qaTask').textContent = askQ ? 'Viết câu hỏi cho câu trả lời trên' : 'Viết câu trả lời';
    const arrange = e.arrange && qa.parts.words.length > 0;
    $('qaArrange').hidden = !arrange; $('qaFree').hidden = arrange;
    $('qaHint').hidden = !arrange; $('qaReset').hidden = !arrange;
    $('qaHint').disabled = qa.done; $('qaReset').disabled = qa.done;
    $('qaNext').disabled = false;
    if (arrange) qaRenderArrange(); else qaRenderFree(e);
  }
  function qaRenderArrange() {
    const { words, end } = qa.parts;
    const line = $('qaLine'); line.innerHTML = '';
    line.classList.toggle('done', qa.done);
    qa.placed.forEach((wi, pos) => {
      const b = document.createElement('button');
      b.className = 'chip placed';
      if (qa.done) b.classList.add('ok');
      else if (qa.bad.has(pos)) b.classList.add('bad');
      if (qa.hinted.has(pos)) b.classList.add('hinted');
      b.textContent = words[wi];
      b.disabled = qa.done || qa.hinted.has(pos);
      b.onclick = () => { qa.placed.splice(pos, 1); qa.bad.clear(); qaShiftHints(pos); msg('qaMsg', ''); qaRender(); };
      line.appendChild(b);
    });
    if (qa.done && end) { const s = document.createElement('span'); s.className = 'chip-end'; s.textContent = end; line.appendChild(s); }
    if (!qa.done && qa.placed.length < words.length) {
      const ph = document.createElement('span'); ph.className = 'chip-ph';
      ph.textContent = qa.placed.length ? '…' : 'Bấm các từ bên dưới để xếp thành câu';
      line.appendChild(ph);
    }
    const tiles = $('qaTiles'); tiles.innerHTML = ''; tiles.hidden = qa.done;
    qa.tiles.forEach(wi => {
      const b = document.createElement('button');
      b.className = 'chip tile-w'; b.textContent = words[wi];
      const used = qa.placed.includes(wi);
      if (used) b.classList.add('used');
      b.disabled = used;
      b.onclick = () => { if (qa.done) return; qa.placed.push(wi); qa.bad.clear(); qaRender(); if (qa.placed.length === words.length) qaCheckArrange(); };
      tiles.appendChild(b);
    });
  }
  function qaShiftHints(removedPos) {      // gợi ý luôn nằm ở đầu câu nên chỉ cần dời chỉ số
    const n = new Set();
    qa.hinted.forEach(p => { if (p < removedPos) n.add(p); else if (p > removedPos) n.add(p - 1); });
    qa.hinted = n;
  }
  function qaCheckArrange() {
    const { words } = qa.parts;
    qa.bad = new Set();
    qa.placed.forEach((wi, pos) => { if (!eqW(words[wi], words[pos])) qa.bad.add(pos); });
    if (!qa.bad.size) qaSuccess();
    else {
      beep(false);
      msg('qaMsg', 'Chưa đúng, bấm vào từ màu đỏ để bỏ ra và xếp lại', 'bad');
      qaRender(); shake($('qaLine'));
    }
  }
  function qaHint() {
    if (qa.done) return;
    const { words } = qa.parts;
    let pos = 0;
    while (pos < qa.placed.length && eqW(words[qa.placed[pos]], words[pos])) pos++;
    if (pos >= words.length) return;
    qa.placed = qa.placed.slice(0, pos);
    qa.hinted = new Set([...qa.hinted].filter(p => p < pos));
    const wi = qa.tiles.find(i => !qa.placed.includes(i) && eqW(words[i], words[pos]));
    if (wi === undefined) return;
    qa.placed.push(wi); qa.hinted.add(pos); qa.bad.clear();
    msg('qaMsg', '');
    qaRender();
    if (qa.placed.length === words.length) qaCheckArrange();
  }
  function qaSuccess() {
    const e = qaCur();
    qa.done = true; beep(true);
    msg('qaMsg', 'Chính xác!', 'ok');
    qaRender();
    setTimeout(() => speakNow(e.answer), 300);
    clearTimeout(qa.timer);
    qa.timer = setTimeout(() => { if (qa.done && visible('viewQA')) qaGo(1); }, 3500);
  }
  function qaRenderFree(e) {
    const t = $('qaText');
    t.readOnly = qa.done;
    t.placeholder = e.direction === 'question' ? 'Viết câu hỏi của em…' : 'Viết câu trả lời của em…';
    $('qaCheck').disabled = qa.done || !e.answer;
    $('qaCheck').hidden = !e.answer;
    $('qaShow').hidden = !e.answer;
    const sm = $('qaSample');
    sm.hidden = !(qa.sample || qa.done) || !e.answer;
    sm.textContent = 'Đáp án mẫu: ' + (e.answer || '');
    if (!e.answer && !$('qaMsg').textContent) msg('qaMsg', 'Bài tự luyện: viết hoặc nói câu của em, rồi bấm › để sang bài tiếp.');
  }
  function qaCheckFree() {
    const e = qaCur(); if (!e || !e.answer || qa.done) return;
    const t = $('qaText');
    if (!t.value.trim()) { msg('qaMsg', 'Em hãy viết hoặc nói câu trước nhé', 'bad'); return; }
    if (norm(t.value) === norm(e.answer)) {
      t.classList.remove('bad'); t.classList.add('ok');
      qaSuccess();
    } else {
      beep(false);
      t.classList.remove('ok'); t.classList.add('bad'); shake(t);
      msg('qaMsg', 'Chưa giống đáp án mẫu. Thử lại hoặc bấm “Xem đáp án mẫu”.', 'bad');
    }
  }
  function qaGo(d) {
    if (!qa.deck.length) return;
    const e = qaCur();
    clearTimeout(qa.timer); stopMic();
    qa.idx = (qa.idx + d + qa.deck.length) % qa.deck.length;
    qa.forId = null; qaRender();
  }
  $('qaPrev').onclick = () => qaGo(-1);
  $('qaNext').onclick = () => qaGo(1);
  $('qaHint').onclick = qaHint;
  $('qaReset').onclick = () => { qa.forId = null; qaRender(); };
  $('qaSay').onclick = () => { const e = qaCur(); if (e) speakNow(e.prompt); };
  $('qaCheck').onclick = qaCheckFree;
  $('qaShow').onclick = () => { const e = qaCur(); qa.sample = true; qaRender(); if (e) speakNow(e.answer); };
  $('qaText').oninput = () => { $('qaText').classList.remove('bad'); if ($('qaMsg').classList.contains('bad')) msg('qaMsg', ''); };
  $('qaText').onkeydown = ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); qaCheckFree(); } };
  $('qaTopic').onchange = () => { qa.deck = []; qa.idx = 0; qa.forId = null; qaSync(); };

  // Nói thay vì viết (Chrome, Edge, Safari có hỗ trợ)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  $('qaMic').hidden = !SR;
  function stopMic() { if (rec) { try { rec.stop(); } catch (e) {} } }
  $('qaMic').onclick = () => {
    if (!SR || qa.done) return;
    if (rec) { stopMic(); return; }
    rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
    $('qaMic').textContent = '⏺ Đang nghe… (bấm để dừng)'; $('qaMic').classList.add('rec');
    rec.onresult = ev => { $('qaText').value = [...ev.results].map(r => r[0].transcript).join(' '); $('qaText').classList.remove('bad'); };
    rec.onerror = ev => { if (ev.error === 'not-allowed') msg('qaMsg', 'Trình duyệt chưa cho dùng micro. Hãy cho phép micro rồi thử lại.', 'bad'); };
    rec.onend = () => {
      rec = null; $('qaMic').textContent = '🎤 Nói'; $('qaMic').classList.remove('rec');
      if ($('qaText').value.trim() && qaCur()?.answer) qaCheckFree();
    };
    rec.start();
  };

  /* ======================= NGHE – CHỌN ======================= */
  const ls = { deck: [], idx: 0, forId: null, done: false, opts: [], wrong: new Set(), timer: null };
  const lsCur = () => ex.find(e => e.id === ls.deck[ls.idx]);
  function lsSync() { syncDeck(ls, 'listen', $('lsTopic').value); lsRender(); }
  function lsNew(e) {
    ls.forId = e.id; ls.done = false; ls.wrong = new Set(); clearTimeout(ls.timer);
    const seen = new Set([norm(e.answer)]);
    const wrongs = e.options.map(o => (o || '').trim()).filter(o => o && !seen.has(norm(o)) && seen.add(norm(o)));
    ls.opts = shuffled([e.answer.trim(), ...wrongs]);
    msg('lsMsg', '');
    setupAudio($('lsAudio'), e);
    if (visible('viewListen')) setTimeout(() => { if (ls.forId === e.id) playEx(e, $('lsAudio')); }, 400);
  }
  function lsRender() {
    const has = ls.deck.length > 0;
    emptyState('lsBox', 'lsEmpty', 'lsCounter', has, 'Vào tab “Tạo thẻ” để tạo bài Nghe.');
    if (!has) return;
    const e = lsCur();
    if (ls.forId !== e.id) lsNew(e);
    $('lsCounter').textContent = (ls.idx + 1) + ' / ' + ls.deck.length;
    const img = $('lsImg'); img.hidden = !e.url; if (e.url && img.getAttribute('src') !== e.url) img.setAttribute('src', e.url);
    $('lsQuestion').textContent = e.prompt || 'Nghe và chọn đáp án đúng';
    $('lsNext').disabled = false;
    $('lsScript').hidden = !ls.done || !e.audio_text;
    $('lsScript').textContent = 'Lời bài nghe: ' + (e.audio_text || '');
    const box = $('lsChoices'); box.innerHTML = '';
    ls.opts.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      const ok = ls.done && eqW(o, e.answer), bad = ls.wrong.has(norm(o));
      if (ok) b.classList.add('ok');
      if (bad) b.classList.add('bad');
      b.disabled = ls.done || bad;
      b.innerHTML = `<span class="key">${String.fromCharCode(65 + i)}</span><span class="txt"></span><span class="mark">${ok ? ICON_OK : bad ? ICON_BAD : ''}</span>`;
      b.querySelector('.txt').textContent = o;
      b.onclick = () => lsPick(o, b);
      box.appendChild(b);
    });
  }
  function lsPick(o, btn) {
    const e = lsCur(); if (!e || ls.done) return;
    if (eqW(o, e.answer)) {
      ls.done = true; beep(true); msg('lsMsg', 'Chính xác!', 'ok'); lsRender();
      clearTimeout(ls.timer);
      ls.timer = setTimeout(() => { if (ls.done && visible('viewListen')) lsGo(1); }, 4000);
    } else {
      beep(false); ls.wrong.add(norm(o));
      msg('lsMsg', 'Chưa đúng, nghe lại và chọn tiếp nhé', 'bad');
      lsRender();
      const b = [...$('lsChoices').children].find(x => x.querySelector('.txt').textContent === o);
      if (b) shake(b);
    }
  }
  function lsGo(d) {
    if (!ls.deck.length) return;
    clearTimeout(ls.timer);
    stopAllAudio();
    ls.idx = (ls.idx + d + ls.deck.length) % ls.deck.length;
    ls.forId = null; lsRender();
  }
  $('lsPrev').onclick = () => lsGo(-1);
  $('lsNext').onclick = () => lsGo(1);
  $('lsPlay').onclick = () => playEx(lsCur(), $('lsAudio'));
  $('lsTopic').onchange = () => { ls.deck = []; ls.idx = 0; ls.forId = null; lsSync(); };


  /* ======================= NGHE – ĐIỀN TỪ ======================= */
  const fd = { deck: [], idx: 0, forId: null, done: false, vals: [], marks: [], showAns: false, focus: 0 };
  const fdCur = () => ex.find(e => e.id === fd.deck[fd.idx]);
  // Đáp án: mỗi dòng (hoặc dấu phẩy) là 1 chỗ trống; "photo/photos" = chấp nhận nhiều cách
  const fdAnswers = e => (e.answer || '').split(/\n|,/).map(x => x.replace(/^\s*\d+\s*[.):-]\s*/, '').trim()).filter(Boolean);
  const fdOk = (val, ans) => ans.split('/').some(a => norm(a) === norm(val));
  function fdSync() { syncDeck(fd, 'fill', $('fdTopic').value); fdRender(); }
  function fdNew(e) {
    fd.forId = e.id; fd.done = false; fd.showAns = false; fd.focus = 0;
    const n = fdAnswers(e).length;
    fd.vals = Array(n).fill(''); fd.marks = Array(n).fill('');
    msg('fdMsg', '');
    setupAudio($('fdAudio'), e);
    $('fdImg').classList.remove('zoomed');
  }
  function fdBank(e) {
    if (!e.arrange) return [];
    const words = fdAnswers(e).map(a => a.split('/')[0].trim()).concat(e.options.map(o => (o || '').trim()).filter(Boolean));
    const seen = new Set(); const uniq = words.filter(w => { const k = norm(w); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!fd.bankFor || fd.bankFor !== e.id) { fd.bankFor = e.id; fd.bank = shuffled(uniq); }
    return fd.bank;
  }
  function fdRender() {
    const has = fd.deck.length > 0;
    emptyState('fdBox', 'fdEmpty', 'fdCounter', has, 'Vào tab “Tạo thẻ” để tạo bài Nghe – Điền từ.');
    if (!has) return;
    const e = fdCur();
    if (fd.forId !== e.id) fdNew(e);
    $('fdCounter').textContent = (fd.idx + 1) + ' / ' + fd.deck.length;
    const img = $('fdImg'); img.hidden = !e.url; if (e.url && img.getAttribute('src') !== e.url) img.setAttribute('src', e.url);
    $('fdPrompt').textContent = e.prompt || 'Nghe và điền từ vào chỗ trống theo thứ tự 1, 2, 3…';
    $('fdTts').hidden = !!e.audioUrl || !e.audio_text;
    $('fdAudioTools').hidden = !e.audioUrl;
    const answers = fdAnswers(e);
    const bankMode = fdBank(e).length > 0 && !fd.done && !fd.showAns;   // có từ gợi ý: kéo thả / bấm chọn, không cần gõ
    const box = $('fdBlanks'); box.innerHTML = '';
    answers.forEach((ans, i) => {
      const w = document.createElement('label'); w.className = 'fd-blank'; w.dataset.i = i;
      if (fd.marks[i]) w.classList.add(fd.marks[i]);
      if (bankMode) { w.classList.add('pick'); if (fd.focus === i && fd.marks[i] !== 'ok') w.classList.add('sel'); }
      w.innerHTML = `<span class="fd-num">${i + 1}</span><input class="field" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="fd-mark">${fd.marks[i] === 'ok' ? ICON_OK : fd.marks[i] === 'bad' ? ICON_BAD : ''}</span>`;
      const inp = w.querySelector('input');
      inp.value = fd.showAns ? ans.split('/')[0] : fd.vals[i];
      inp.readOnly = fd.done || fd.showAns || fd.marks[i] === 'ok' || bankMode;
      if (bankMode) { inp.tabIndex = -1; inp.setAttribute('inputmode', 'none'); }
      inp.setAttribute('aria-label', 'Chỗ trống ' + (i + 1));
      inp.onfocus = () => { fd.focus = i; };
      inp.oninput = () => { fd.vals[i] = inp.value; if (fd.marks[i] === 'bad') { fd.marks[i] = ''; w.classList.remove('bad'); w.querySelector('.fd-mark').innerHTML = ''; } };
      inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); const nx = box.querySelectorAll('input')[i + 1]; if (nx) nx.focus(); else fdCheck(); } };
      if (bankMode) {
        w.onclick = ev => { ev.preventDefault(); if (fd.marks[i] === 'ok') return; fd.focus = i; fdRender(); };
        if (fd.vals[i] && fd.marks[i] !== 'ok') {
          const x = document.createElement('button');
          x.className = 'fd-clear'; x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Xoá từ ở ô ' + (i + 1));
          x.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); fd.vals[i] = ''; fd.marks[i] = ''; fd.focus = i; fdRender(); };
          w.appendChild(x);
        }
      }
      box.appendChild(w);
    });
    const bank = fdBank(e);
    const bk = $('fdBank'); bk.innerHTML = ''; bk.hidden = !bank.length || fd.done || fd.showAns;
    bank.forEach(word => {
      const b = document.createElement('button');
      b.className = 'chip bank-w'; b.textContent = word;
      if (fd.vals.some(v => norm(v) === norm(word))) b.classList.add('used');
      b.onclick = () => { if (b.dataset.dragged) { delete b.dataset.dragged; return; } fdPut(word); };
      enableDrag(b, word);
      bk.appendChild(b);
    });
    $('fdCheck').disabled = fd.done || fd.showAns;
    $('fdShow').disabled = fd.showAns;
  }
  function fdPut(word) {          // bấm từ gợi ý: điền vào ô đang chọn (hoặc ô trống đầu tiên)
    const n = fd.vals.length;
    let i = fd.focus;
    if (i == null || i >= n || fd.marks[i] === 'ok' || (fd.vals[i] && fd.marks[i] !== 'bad')) i = fd.vals.findIndex((v, k) => !v && fd.marks[k] !== 'ok');
    if (i < 0) return;
    fd.vals[i] = word; fd.marks[i] = '';
    const nxt = fd.vals.findIndex((v, k) => !v && fd.marks[k] !== 'ok');
    fd.focus = nxt >= 0 ? nxt : i;
    fdRender();
  }
  function fdPutAt(i, word) {     // thả từ vào đúng ô
    if (fd.done || fd.showAns || i == null || i >= fd.vals.length || fd.marks[i] === 'ok') return;
    fd.vals[i] = word; fd.marks[i] = '';
    const nxt = fd.vals.findIndex((v, k) => !v && fd.marks[k] !== 'ok');
    fd.focus = nxt >= 0 ? nxt : i;
    fdRender();
  }
  // Kéo thả bằng chuột và cảm ứng (tablet/điện thoại)
  function enableDrag(chip, word) {
    chip.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const sx = ev.clientX, sy = ev.clientY;
      let ghost = null, over = null;
      try { chip.setPointerCapture(ev.pointerId); } catch (x) {}
      const move = e => {
        if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
        if (!ghost) { ghost = chip.cloneNode(true); ghost.className = 'chip bank-w drag-ghost'; document.body.appendChild(ghost); chip.classList.add('dragging'); }
        ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const t = el && el.closest('.fd-blank');
        if (over && over !== t) over.classList.remove('drop-over');
        over = t && !t.classList.contains('ok') ? t : null;
        if (over) over.classList.add('drop-over');
      };
      const up = () => {
        chip.removeEventListener('pointermove', move); chip.removeEventListener('pointerup', up); chip.removeEventListener('pointercancel', up);
        if (!ghost) return;
        ghost.remove(); chip.classList.remove('dragging'); chip.dataset.dragged = '1';
        setTimeout(() => delete chip.dataset.dragged, 50);
        if (over) { over.classList.remove('drop-over'); fdPutAt(+over.dataset.i, word); }
      };
      chip.addEventListener('pointermove', move); chip.addEventListener('pointerup', up); chip.addEventListener('pointercancel', up);
    });
  }
  function fdCheck() {
    const e = fdCur(); if (!e || fd.done) return;
    const answers = fdAnswers(e);
    let right = 0;
    answers.forEach((a, i) => {
      if (!fd.vals[i].trim()) { fd.marks[i] = ''; return; }
      fd.marks[i] = fdOk(fd.vals[i], a) ? 'ok' : 'bad';
      if (fd.marks[i] === 'ok') right++;
    });
    if (right === answers.length) {
      fd.done = true; beep(true); msg('fdMsg', `Tuyệt vời! Đúng cả ${right}/${answers.length} chỗ trống.`, 'ok');
    } else {
      beep(false);
      const empty = answers.length - fd.marks.filter(Boolean).length;
      msg('fdMsg', `Đúng ${right}/${answers.length}.` + (empty ? ` Còn ${empty} ô trống.` : '') + ' Sửa các ô đỏ rồi kiểm tra lại nhé.', 'bad');
    }
    fdRender();
  }
  function fdGo(d) {
    if (!fd.deck.length) return;
    stopAllAudio();
    fd.idx = (fd.idx + d + fd.deck.length) % fd.deck.length;
    fd.forId = null; fdRender();
  }
  $('fdPrev').onclick = () => fdGo(-1);
  $('fdNext').onclick = () => fdGo(1);
  $('fdCheck').onclick = fdCheck;
  $('fdReset').onclick = () => { fd.forId = null; fd.bankFor = null; fdRender(); };
  $('fdShow').onclick = () => { fd.showAns = true; msg('fdMsg', 'Đáp án đã hiện. Bấm “Làm lại” để làm lại từ đầu.'); fdRender(); };
  $('fdTts').onclick = () => playEx(fdCur(), $('fdAudio'));
  $('fdBack').onclick = () => { const a = $('fdAudio'); a.currentTime = Math.max(0, a.currentTime - 5); };
  $('fdSpeed').onchange = () => { $('fdAudio').playbackRate = parseFloat($('fdSpeed').value); };
  $('fdAudio').addEventListener('loadedmetadata', () => { $('fdAudio').playbackRate = parseFloat($('fdSpeed').value); });
  $('fdImg').onclick = () => $('fdImg').classList.toggle('zoomed');
  $('fdTopic').onchange = () => { fd.deck = []; fd.idx = 0; fd.forId = null; fdSync(); };

  window.addEventListener('hashchange', () => {
    if (location.hash === '#hoi-dap') qaRender();
    if (location.hash !== '#hoi-dap') stopMic();
    stopAllAudio();
    if (location.hash === '#nghe') { ls.forId = null; lsRender(); }
    if (location.hash === '#nghe-dien') fdRender();
  });
  document.addEventListener('keydown', ev => {
    if (ev.target.matches('input,select,textarea')) return;
    if (visible('viewListen')) {
      const k = ev.key.toUpperCase();
      if (/^[A-D]$/.test(k)) { const b = $('lsChoices').children[k.charCodeAt(0) - 65]; if (b && !b.disabled) b.click(); }
      else if (ev.key === ' ') { ev.preventDefault(); $('lsPlay').click(); }
      else if (ev.key === 'ArrowRight') lsGo(1); else if (ev.key === 'ArrowLeft') lsGo(-1);
    } else if (visible('viewFill')) {
      if (ev.key === 'ArrowRight') fdGo(1); else if (ev.key === 'ArrowLeft') fdGo(-1);
    } else if (visible('viewQA')) {
      if (ev.key === 'ArrowRight') qaGo(1); else if (ev.key === 'ArrowLeft') qaGo(-1);
    }
  });

  /* ======================= TẠO BÀI (quản lý) ======================= */
  sb.auth.getSession().then(({ data }) => { session = data.session; renderExList(); });
  sb.auth.onAuthStateChange((_e, s) => { session = s; renderExList(); });

  async function uploadImage(file) {
    const blob = await shrink(file);
    const path = `ex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extOf(blob.type)}`;
    const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
    if (up.error) throw up.error;
    return path;
  }
  // File WAV rất nặng: tự nén thành mono 22 kHz (giọng nói vẫn rõ, nhẹ hơn ~4 lần)
  async function compressAudio(file) {
    const isWav = /wav/i.test(file.type) || /\.wav$/i.test(file.name);
    if (!isWav || file.size < 1.5e6) return file;
    try {
      const buf = await file.arrayBuffer();
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const audio = await new Promise((res, rej) => ac.decodeAudioData(buf, res, rej));
      if (ac.close) ac.close();
      const rate = 22050, len = Math.ceil(audio.duration * rate);
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const off = new OAC(1, len, rate);
      const s = off.createBufferSource(); s.buffer = audio; s.connect(off.destination); s.start(0);
      const out = await off.startRendering();
      const blob = encodeWav(out.getChannelData(0), rate);
      return blob.size < file.size ? blob : file;
    } catch (e) { return file; }
  }
  function encodeWav(samples, rate) {
    const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0, o = 44; i < samples.length; i++, o += 2) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7FFF, true); }
    return new Blob([b], { type: 'audio/wav' });
  }
  const audioExt = t => ({ 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'webm' }[t] || 'audio');
  async function uploadAudio(file, statusId) {
    if (statusId) setStatus(statusId, 'Đang xử lý file nghe…');
    const blob = await compressAudio(file);
    const type = blob.type || file.type || 'audio/mpeg';
    const path = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${audioExt(type)}`;
    if (statusId) setStatus(statusId, `Đang tải file nghe lên (${(blob.size / 1048576).toFixed(1)} MB)…`);
    const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: '31536000' });
    if (up.error) throw up.error;
    return path;
  }
  const nextOrder = () => (ex.length ? Math.max(...ex.map(e => e.sort_order)) : 0) + 1;
  function bindPreview(inputId, imgId) {
    $(inputId).onchange = () => {
      const f = $(inputId).files[0], img = $(imgId);
      if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
      if (f) { img.dataset.url = URL.createObjectURL(f); img.src = img.dataset.url; img.hidden = false; }
      else img.hidden = true;
    };
  }
  function clearPreview(inputId, imgId) { $(inputId).value = ''; const img = $(imgId); img.hidden = true; if (img.dataset.url) URL.revokeObjectURL(img.dataset.url); }
  bindPreview('qfImg', 'qfPrev'); bindPreview('lfImg', 'lfPrev'); bindPreview('ffImg', 'ffPrev');

  const qfLabels = () => {
    const q = $('qfDir').value === 'question';
    $('qfPrompt').placeholder = q ? 'Câu trả lời cho sẵn (vd: I am eight years old.)' : 'Câu hỏi cho sẵn (vd: How old are you?)';
    $('qfAnswer').placeholder = q ? 'Câu hỏi đúng HS cần viết (vd: How old are you?)' : 'Câu trả lời đúng (vd: I am eight years old.)';
    if ($('qfArr').value === '0') $('qfAnswer').placeholder += ', để trống nếu không chấm';
  };
  $('qfDir').onchange = qfLabels; $('qfArr').onchange = qfLabels; qfLabels();

  $('qfSave').onclick = async () => {
    const prompt = $('qfPrompt').value.trim(), answer = $('qfAnswer').value.trim(), arrange = $('qfArr').value === '1';
    if (!prompt) { setStatus('qfStatus', 'Nhập câu cho sẵn.', true); return; }
    if (arrange && splitSentence(answer).words.length < 2) { setStatus('qfStatus', 'Kiểu sắp xếp cần câu đáp án có ít nhất 2 từ.', true); return; }
    $('qfSave').disabled = true; setStatus('qfStatus', 'Đang lưu…');
    try {
      const f = $('qfImg').files[0];
      const image_path = f ? await uploadImage(f) : null;
      const { error } = await sb.from('exercises').insert({ kind: 'qa', direction: $('qfDir').value, arrange, prompt, answer, topic: $('qfTopic').value.trim(), image_path, sort_order: nextOrder() });
      if (error) throw error;
      setStatus('qfStatus', 'Đã lưu bài.');
      $('qfPrompt').value = ''; $('qfAnswer').value = ''; clearPreview('qfImg', 'qfPrev'); $('qfPrompt').focus();
      load();
    } catch (e) { setStatus('qfStatus', 'Không lưu được: ' + (e.message || e), true); }
    $('qfSave').disabled = false;
  };

  const testAudio = new Audio();
  function testSound(inputId, textId) {
    const f = $(inputId).files[0];
    if (f) { if (testAudio.dataset.url) URL.revokeObjectURL(testAudio.dataset.url); testAudio.dataset.url = URL.createObjectURL(f); testAudio.src = testAudio.dataset.url; testAudio.play().catch(() => {}); }
    else speakNow($(textId).value.trim());
  }
  function bindSound(inputId, nameId) { $(inputId).onchange = () => { const f = $(inputId).files[0]; $(nameId).textContent = f ? '🎵 ' + f.name : ''; }; }
  function clearSound(inputId, nameId) { $(inputId).value = ''; $(nameId).textContent = ''; testAudio.pause(); }
  bindSound('lfSound', 'lfSoundName'); bindSound('ffSound', 'ffSoundName');
  $('lfTest').onclick = () => testSound('lfSound', 'lfAudio');
  $('ffTest').onclick = () => testSound('ffSound', 'ffAudio');

  $('ffSave').onclick = async () => {
    const answer = $('ffAnswers').value.trim();
    const af = $('ffSound').files[0], imf = $('ffImg').files[0], audio_text = $('ffAudio').value.trim();
    if (!imf) { setStatus('ffStatus', 'Chọn hình bài tập.', true); return; }
    if (!af && !audio_text) { setStatus('ffStatus', 'Chọn file nghe hoặc nhập lời bài nghe.', true); return; }
    if (!fdAnswers({ answer }).length) { setStatus('ffStatus', 'Nhập đáp án cho các chỗ trống.', true); return; }
    $('ffSave').disabled = true;
    try {
      setStatus('ffStatus', 'Đang tải hình…');
      const image_path = await uploadImage(imf);
      const audio_path = af ? await uploadAudio(af, 'ffStatus') : null;
      const options = $('ffExtra').value.split(/,|\n/).map(x => x.trim()).filter(Boolean);
      const { error } = await sb.from('exercises').insert({ kind: 'fill', image_path, audio_path, audio_text, answer, options, arrange: $('ffBank').value === '1', prompt: $('ffPrompt').value.trim(), topic: $('ffTopic').value.trim(), sort_order: nextOrder() });
      if (error) throw error;
      setStatus('ffStatus', 'Đã lưu bài.');
      ['ffAnswers', 'ffExtra', 'ffPrompt', 'ffAudio'].forEach(id => ($(id).value = ''));
      clearPreview('ffImg', 'ffPrev'); clearSound('ffSound', 'ffSoundName');
      load();
    } catch (e) { setStatus('ffStatus', 'Không lưu được: ' + (e.message || e), true); }
    $('ffSave').disabled = false;
  };
  $('lfSave').onclick = async () => {
    const audio_text = $('lfAudio').value.trim(), answer = $('lfAnswer').value.trim();
    const options = ['lfW1', 'lfW2', 'lfW3'].map(id => $(id).value.trim()).filter(Boolean);
    const af = $('lfSound').files[0];
    if (!audio_text && !af) { setStatus('lfStatus', 'Nhập lời bài nghe hoặc chọn file nghe.', true); return; }
    if (!answer || !options.length) { setStatus('lfStatus', 'Cần 1 đáp án đúng và ít nhất 1 đáp án sai.', true); return; }
    $('lfSave').disabled = true; setStatus('lfStatus', 'Đang lưu…');
    try {
      const f = $('lfImg').files[0];
      const image_path = f ? await uploadImage(f) : null;
      const audio_path = af ? await uploadAudio(af, 'lfStatus') : null;
      const { error } = await sb.from('exercises').insert({ kind: 'listen', audio_text, audio_path, prompt: $('lfQuestion').value.trim(), answer, options, topic: $('lfTopic').value.trim(), image_path, sort_order: nextOrder() });
      if (error) throw error;
      setStatus('lfStatus', 'Đã lưu bài.');
      ['lfAudio', 'lfQuestion', 'lfAnswer', 'lfW1', 'lfW2', 'lfW3'].forEach(id => ($(id).value = ''));
      clearPreview('lfImg', 'lfPrev'); clearSound('lfSound', 'lfSoundName'); $('lfAudio').focus();
      load();
    } catch (e) { setStatus('lfStatus', 'Không lưu được: ' + (e.message || e), true); }
    $('lfSave').disabled = false;
  };

  /* ---------- Danh sách bài: sửa / đổi tranh / xoá ---------- */
  async function saveField(e, patch) {
    const { error } = await sb.from('exercises').update(patch).eq('id', e.id);
    setStatus('exStatus', error ? 'Không lưu được: ' + error.message : 'Đã lưu.', !!error);
    if (!error) load();
  }
  function field(e, key, ph, opts = {}) {
    const el = document.createElement(opts.area ? 'textarea' : 'input');
    el.className = 'field'; el.placeholder = ph; el.setAttribute('aria-label', ph);
    if (opts.area) el.rows = 2;
    if (opts.list) el.setAttribute('list', 'topicList');
    const val = opts.get ? opts.get(e) : (e[key] || '');
    el.value = val;
    el.onchange = () => {
      const v = el.value.trim();
      if (v === val) return;
      saveField(e, opts.set ? opts.set(v) : { [key]: v });
    };
    if (!opts.area) el.onkeydown = ev => { if (ev.key === 'Enter') el.blur(); };
    return el;
  }
  function select(e, key, choices, toVal = v => v) {
    const s = document.createElement('select'); s.className = 'field';
    choices.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); });
    s.value = String(e[key]);
    s.onchange = () => saveField(e, { [key]: toVal(s.value) });
    return s;
  }
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = 'image/*'; picker.hidden = true; document.body.appendChild(picker);
  let pickFor = null;
  picker.onchange = async () => {
    const f = picker.files[0], e = pickFor; if (!f || !e) return;
    setStatus('exStatus', 'Đang đổi tranh…');
    try {
      const path = await uploadImage(f);
      const { error } = await sb.from('exercises').update({ image_path: path }).eq('id', e.id);
      if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
      if (e.image_path) await sb.storage.from(BUCKET).remove([e.image_path]);
      setStatus('exStatus', 'Đã đổi tranh.'); load();
    } catch (err) { setStatus('exStatus', 'Không đổi được tranh: ' + (err.message || err), true); }
  };

  const soundPicker = document.createElement('input');
  soundPicker.type = 'file'; soundPicker.accept = 'audio/*,.wav,.mp3,.m4a'; soundPicker.hidden = true; document.body.appendChild(soundPicker);
  let soundFor = null;
  soundPicker.onchange = async () => {
    const f = soundPicker.files[0], e = soundFor; if (!f || !e) return;
    try {
      const path = await uploadAudio(f, 'exStatus');
      const { error } = await sb.from('exercises').update({ audio_path: path }).eq('id', e.id);
      if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
      if (e.audio_path) await sb.storage.from(BUCKET).remove([e.audio_path]);
      setStatus('exStatus', 'Đã cập nhật file nghe.'); load();
    } catch (err) { setStatus('exStatus', 'Không tải được file nghe: ' + (err.message || err), true); }
  };
  function audioButtons(e) {
    const wrap = document.createElement('div'); wrap.className = 'row ex-audio-row';
    const t = document.createElement('button');
    t.className = 'btn ghost'; t.type = 'button'; t.textContent = '🔊 Nghe thử';
    t.onclick = () => { if (e.audioUrl) { testAudio.src = e.audioUrl; testAudio.play().catch(() => {}); } else speakNow(e.audio_text); };
    const up = document.createElement('button');
    up.className = 'btn ghost'; up.type = 'button'; up.textContent = e.audio_path ? '🎵 Đổi file nghe' : '🎵 Thêm file nghe';
    up.onclick = () => { soundFor = e; soundPicker.value = ''; soundPicker.click(); };
    wrap.append(t, up);
    if (e.audio_path) {
      const rm = document.createElement('button');
      rm.className = 'btn ghost'; rm.type = 'button'; rm.textContent = 'Bỏ file (dùng giọng máy)';
      rm.onclick = async () => {
        if (!e.audio_text && !confirm('Bài này chưa có lời bài nghe, bỏ file thì sẽ không có tiếng. Vẫn bỏ?')) return;
        const { error } = await sb.from('exercises').update({ audio_path: null }).eq('id', e.id);
        if (error) { setStatus('exStatus', error.message, true); return; }
        await sb.storage.from(BUCKET).remove([e.audio_path]); load();
      };
      wrap.append(rm);
    }
    return wrap;
  }

  function renderExList() {
    const box = $('exList'); if (!box) return;
    box.innerHTML = '';
    if (!session) return;
    if (loadErr) { box.innerHTML = '<p class="status err">Chưa có bảng bài tập. Hãy chạy file update-bai-tap.sql trong Supabase.</p>'; return; }
    const f = $('exFilter').value;
    const shown = ex.filter(e => !f || e.kind === f).slice().reverse();     // bài mới nhất lên đầu
    $('exCount').textContent = ex.length ? `(${ex.length})` : '';
    if (!shown.length) { box.innerHTML = '<p class="status">Chưa có bài nào.</p>'; return; }
    shown.forEach(e => {
      const row = document.createElement('div'); row.className = 'item ex-item';
      const th = document.createElement('button');
      th.className = 'thumb'; th.title = e.url ? 'Đổi tranh' : 'Thêm tranh';
      th.innerHTML = e.url ? '<img alt=""><span>Đổi ảnh</span>' : '<span>+ Ảnh</span>';
      if (e.url) th.querySelector('img').src = e.url; else th.classList.add('noimg');
      th.onclick = () => { pickFor = e; picker.value = ''; picker.click(); };
      const fields = document.createElement('div'); fields.className = 'fields';
      const badge = document.createElement('span'); badge.className = 'ex-badge ' + e.kind;
      badge.textContent = e.kind === 'qa' ? 'Hỏi đáp' : e.kind === 'fill' ? 'Nghe điền' : 'Nghe';
      fields.appendChild(badge);
      if (e.kind === 'qa') {
        fields.append(
          select(e, 'direction', [['answer', 'Cho câu hỏi → viết trả lời'], ['question', 'Cho trả lời → viết câu hỏi']]),
          select(e, 'arrange', [['true', 'Sắp xếp từ'], ['false', 'Tự viết / nói']], v => v === 'true'),
          field(e, 'prompt', 'Câu cho sẵn'),
          field(e, 'answer', 'Câu HS cần viết'),
          field(e, 'topic', 'Chủ đề', { list: true })
        );
      } else if (e.kind === 'fill') {
        fields.append(
          field(e, 'answer', 'Đáp án các chỗ trống, cách nhau bằng dấu phẩy', {
            get: x => fdAnswers(x).join(', '),
            set: v => ({ answer: v.split(',').map(t => t.trim()).filter(Boolean).join('\n') })
          }),
          select(e, 'arrange', [['true', 'Hiện từ gợi ý'], ['false', 'Không hiện từ gợi ý']], v => v === 'true'),
          field(e, 'options', 'Từ gợi ý thêm (gây nhiễu), cách nhau bằng dấu phẩy', {
            get: x => x.options.join(', '),
            set: v => ({ options: v.split(',').map(t => t.trim()).filter(Boolean) })
          }),
          field(e, 'prompt', 'Hướng dẫn hiển thị'),
          field(e, 'audio_text', 'Lời bài nghe (dùng khi không có file)', { area: true }),
          field(e, 'topic', 'Chủ đề', { list: true })
        );
        fields.append(audioButtons(e));
      } else {
        fields.append(
          field(e, 'audio_text', 'Lời bài nghe', { area: true }),
          field(e, 'prompt', 'Câu hỏi hiển thị'),
          field(e, 'answer', '✓ Đáp án đúng'),
          field(e, 'options', '✗ Đáp án sai, cách nhau bằng dấu |', {
            get: x => x.options.join(' | '),
            set: v => ({ options: v.split('|').map(s => s.trim()).filter(Boolean) })
          }),
          field(e, 'topic', 'Chủ đề', { list: true })
        );
        fields.append(audioButtons(e));
      }
      const acts = document.createElement('div'); acts.className = 'acts';
      const del = document.createElement('button');
      del.className = 'ibtn del'; del.setAttribute('aria-label', 'Xoá bài'); del.innerHTML = ICON_DEL;
      del.onclick = async () => {
        if (!confirm('Xoá bài này?')) return;
        const { error } = await sb.from('exercises').delete().eq('id', e.id);
        if (error) { setStatus('exStatus', 'Không xoá được: ' + error.message, true); return; }
        const files = [e.image_path, e.audio_path].filter(Boolean);
        if (files.length) await sb.storage.from(BUCKET).remove(files);
        setStatus('exStatus', 'Đã xoá.'); load();
      };
      acts.appendChild(del);
      row.append(th, fields, acts);
      box.appendChild(row);
    });
  }
  $('exFilter').onchange = renderExList;
})();
