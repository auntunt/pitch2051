/* 20·5·1 — 一分钟讲明白。纯前端，无后端，无上报。 */
'use strict';

const $ = id => document.getElementById(id);
const PHASES = [
  { key:'research', name:'研究', color:'--t1',
    hint:'可以查任何资料。笔记记在下面。' },
  { key:'prep', name:'准备', color:'--t2',
    hint:'不许再查资料了。把攒的料串成一条能讲的线。' },
  { key:'talk', name:'呈现', color:'--t3',
    hint:'对着镜头或空气讲。卡壳了自己按一下。' },
];
const TALLY_LABEL = { stuck:'卡壳', slur:'口齿不清', drift:'跑题', filler:'嗯…那个' };
const LS_KEY = 'pitch2051.history.v1';

const S = {
  topic:'', mins:{research:20,prep:5,talk:1},
  pi:0, left:0, total:0, paused:false, timer:null,
  tally:{stuck:0,slur:0,drift:0,filler:0},
  notes:'', startedAt:0, talkSpent:0,
  wantRec:false, sound:true,
  rec:null, chunks:[], audioURL:null,
};

/* ---------- 提示音（WebAudio，无外部资源） ---------- */
let AC = null;
function beep(times = 1) {
  if (!S.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const t = AC.currentTime + i * 0.26;
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine'; o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(AC.destination); o.start(t); o.stop(t + 0.24);
    }
  } catch (e) { /* 静默：某些浏览器未授权音频 */ }
}

function fmt(s) {
  s = Math.max(0, Math.round(s));
  return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
}
function show(v) {
  ['view-setup','view-run','view-done'].forEach(id => $(id).classList.toggle('hidden', id !== v));
  window.scrollTo(0, 0);
}

/* ---------- 计时核心 ---------- */
const RING_LEN = 2 * Math.PI * 92;

function paintRing(ratio) {
  const el = $('ring-fg');
  el.style.strokeDasharray = RING_LEN;
  el.style.strokeDashoffset = RING_LEN * (1 - Math.max(0, Math.min(1, ratio)));
}

function enterPhase(i) {
  S.pi = i;
  const p = PHASES[i];
  S.total = S.mins[p.key] * 60;
  S.left = S.total;
  S.paused = false;
  document.body.classList.remove('warn','paused');

  $('phase-name').textContent = p.name;
  $('stage-hint').textContent = p.hint;
  $('ring-fg').style.stroke = `var(${p.color})`;
  document.querySelectorAll('.rail-item').forEach((el, idx) => {
    el.classList.toggle('on', idx === i);
    el.classList.toggle('done', idx < i);
  });
  $('btn-next').textContent = i < 2 ? '提前进入下一段' : '讲完了 · 看复盘';
  $('btn-pause').textContent = '暂停';

  const talk = p.key === 'talk';
  $('notes-card').classList.toggle('hidden', talk);
  $('talk-card').classList.toggle('hidden', !talk);

  if (p.key === 'prep') {
    $('notes').disabled = false;              // 准备阶段仍可整理已有笔记
    $('notes-label').textContent = '整理：把料串成线';
    $('notes-lock').classList.remove('hidden');
  } else if (p.key === 'research') {
    $('notes').disabled = false;
    $('notes-label').textContent = '研究笔记';
    $('notes-lock').classList.add('hidden');
  } else {
    $('notes-peek').textContent = S.notes || '（这场没记笔记）';
    if (S.wantRec) startRec();
  }

  tick(true);
  clearInterval(S.timer);
  S.timer = setInterval(tick, 1000);
}

function tick(first) {
  if (!first) {
    if (S.paused) return;
    S.left -= 1;
    if (PHASES[S.pi].key === 'talk') S.talkSpent += 1;
  }
  $('clock').textContent = fmt(S.left);
  paintRing(S.total ? S.left / S.total : 0);
  document.body.classList.toggle('warn', S.left <= 10 && S.left > 0);
  if (S.left <= 0) {
    clearInterval(S.timer);
    beep(PHASES[S.pi].key === 'talk' ? 3 : 2);
    if (S.pi < 2) enterPhase(S.pi + 1); else finish();
  }
}

/* ---------- 录音（可选，仅本机内存 blob） ---------- */
async function startRec() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    $('rec-state').textContent = '这个浏览器不支持录音'; return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    S.chunks = [];
    S.rec = new MediaRecorder(stream);
    S.rec.ondataavailable = e => { if (e.data.size) S.chunks.push(e.data); };
    S.rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (S.chunks.length) S.audioURL = URL.createObjectURL(new Blob(S.chunks, { type:S.rec.mimeType || 'audio/webm' }));
    };
    S.rec.start();
    $('rec-dot').classList.add('live');
    $('rec-state').textContent = '录音中（只存在本机，关页面就没了）';
  } catch (e) {
    $('rec-state').textContent = '录音被拒绝，继续讲也行';
  }
}
function stopRec() {
  if (S.rec && S.rec.state !== 'inactive') S.rec.stop();
  $('rec-dot').classList.remove('live');
}

/* ---------- 复盘 ---------- */
function finish() {
  clearInterval(S.timer);
  stopRec();
  S.notes = $('notes').value;

  const total = Object.values(S.tally).reduce((a,b) => a+b, 0);
  const words = S.notes.replace(/\s/g,'').length;

  $('done-topic').textContent = S.topic || '未命名的一场';
  $('done-when').textContent =
    new Date(S.startedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
    + ` · ${S.mins.research}/${S.mins.prep}/${S.mins.talk} 分钟`;
  $('s-total').textContent = total;
  $('s-words').textContent = words;
  $('s-talk').textContent = S.talkSpent + 's';

  const max = Math.max(1, ...Object.values(S.tally));
  $('bars').innerHTML = Object.keys(TALLY_LABEL).map(k => `
    <div class="bar-row">
      <span>${TALLY_LABEL[k]}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${S.tally[k]/max*100}%"></div></div>
      <em>${S.tally[k]}</em>
    </div>`).join('');

  $('verdict').textContent = verdict(total, words);
  $('notes-dump').textContent = S.notes || '（这场没记笔记）';

  if (S.audioURL) {
    $('player').src = S.audioURL;
    $('audio-card').classList.remove('hidden');
  } else {
    $('audio-card').classList.add('hidden');
  }

  saveHistory({ topic:S.topic, at:S.startedAt, tally:{...S.tally}, total, words, talk:S.talkSpent });
  show('view-done');
}

function verdict(total, words) {
  if (total === 0 && words > 0) return '一次没卡。要么你本来就熟，要么下次把呈现时间砍一半再试。';
  if (total <= 2) return '很稳。卡壳少通常不是嘴的功劳，是准备阶段真的把线串起来了。';
  if (total <= 5) return '正常水位。回头看笔记，卡住的地方大多是你抄下来但没用自己的话重写过的那几条。';
  return '卡得多说明还停在「知识点」阶段，没变成「知识面」。同一个题目，隔一天再讲一次，对比这个数字。';
}

/* ---------- 历史（localStorage） ---------- */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch (e) { return []; }
}
function saveHistory(rec) {
  const h = loadHistory(); h.unshift(rec);
  try { localStorage.setItem(LS_KEY, JSON.stringify(h.slice(0, 30))); } catch (e) {}
}
function renderHistory() {
  const h = loadHistory();
  $('history-wrap').classList.toggle('hidden', h.length === 0);
  $('history').innerHTML = h.map(r => `
    <div class="hist-item">
      <div class="hist-t">${esc(r.topic || '未命名')}
        <small>${new Date(r.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · 笔记 ${r.words} 字</small>
      </div>
      <div class="hist-n">失误 ${r.total}</div>
    </div>`).join('');
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- 事件绑定 ---------- */
$('btn-start').onclick = () => {
  const g = (id, d, lo, hi) => {
    const v = parseInt($(id).value, 10);
    return (isNaN(v) || v < lo || v > hi) ? d : v;
  };
  S.topic = $('topic').value.trim();
  S.mins = { research:g('m-research',20,1,120), prep:g('m-prep',5,1,60), talk:g('m-talk',1,1,30) };
  S.wantRec = $('opt-rec').checked;
  S.sound = $('opt-sound').checked;
  S.tally = { stuck:0, slur:0, drift:0, filler:0 };
  S.talkSpent = 0; S.notes = ''; S.audioURL = null;
  S.startedAt = Date.now();

  $('notes').value = '';
  $('note-count').textContent = '0 字';
  Object.keys(TALLY_LABEL).forEach(k => { $('c-'+k).textContent = '0'; });
  $('rec-state').textContent = S.wantRec ? '正在请求麦克风…' : '未录音';
  $('run-topic').textContent = S.topic || '未命名的一场';

  if (S.sound) beep(1);            // 顺带解锁 iOS 音频上下文
  show('view-run');
  enterPhase(0);
};

$('btn-pause').onclick = () => {
  S.paused = !S.paused;
  document.body.classList.toggle('paused', S.paused);
  $('btn-pause').textContent = S.paused ? '继续' : '暂停';
};

$('btn-next').onclick = () => {
  if (S.pi < 2) { S.notes = $('notes').value; beep(1); enterPhase(S.pi + 1); }
  else finish();
};

$('btn-abort').onclick = () => {
  if (!confirm('放弃这一场？记录不会保存。')) return;
  clearInterval(S.timer); stopRec();
  document.body.classList.remove('warn','paused');
  renderHistory(); show('view-setup');
};

$('notes').oninput = e => {
  $('note-count').textContent = e.target.value.replace(/\s/g,'').length + ' 字';
};

document.querySelectorAll('.tally').forEach(b => {
  b.onclick = () => {
    const k = b.dataset.k;
    S.tally[k]++; $('c-'+k).textContent = S.tally[k];
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 220);
    if (navigator.vibrate) navigator.vibrate(18);
  };
});

$('btn-again').onclick = () => { renderHistory(); show('view-setup'); };

$('btn-copy').onclick = async () => {
  const lines = [
    `【${S.topic || '未命名'}】${S.mins.research}/${S.mins.prep}/${S.mins.talk} 分钟`,
    ...Object.keys(TALLY_LABEL).map(k => `${TALLY_LABEL[k]}：${S.tally[k]}`),
    `实际讲了 ${S.talkSpent} 秒`, '', '笔记：', S.notes || '（无）',
  ].join('\n');
  try { await navigator.clipboard.writeText(lines); $('btn-copy').textContent = '已复制'; }
  catch (e) { $('btn-copy').textContent = '复制失败，手动选中吧'; }
  setTimeout(() => { $('btn-copy').textContent = '复制这场记录'; }, 1800);
};

$('btn-clear').onclick = () => {
  if (!confirm('清空全部历史记录？')) return;
  localStorage.removeItem(LS_KEY); renderHistory();
};

/* 呈现阶段：空格键记一次卡壳 */
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !$('view-run').classList.contains('hidden')
      && PHASES[S.pi].key === 'talk' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    document.querySelector('.tally[data-k=stuck]').click();
  }
});

window.addEventListener('beforeunload', e => {
  if (!$('view-run').classList.contains('hidden')) { e.preventDefault(); e.returnValue = ''; }
});

renderHistory();
