/* 20·5·1·5 — 一分钟讲明白，再被外行追问。
   纯前端：无后端、无 API key、无上报。对话在你自己的 ChatGPT 客户端里发生。 */
'use strict';

const $ = id => document.getElementById(id);

const PHASES = [
  { key:'research', name:'研究', color:'--t1', hint:'可以查任何资料。笔记记在下面。' },
  { key:'prep',     name:'准备', color:'--t2', hint:'不许再查资料了。把攒的料串成一条能讲的线。' },
  { key:'talk',     name:'呈现', color:'--t3', hint:'对着镜头或空气讲。卡壳了自己按一下。' },
  { key:'grill',    name:'受审', color:'--t4', hint:'把话术念给 ChatGPT，让它扮外行追问。答完把对话粘回来。' },
];
const TALLY_LABEL = { stuck:'卡壳', slur:'口齿不清', drift:'跑题', filler:'嗯…那个' };
const LS_KEY = 'pitch2051.history.v2';

const S = {
  topic:'', mins:{research:20,prep:5,talk:1,grill:5},
  pi:0, left:0, total:0, paused:false, timer:null,
  tally:{stuck:0,slur:0,drift:0,filler:0},
  notes:'', startedAt:0, talkSpent:0,
  level:'normal', dialogue:'', questions:[], answered:{},
  wantRec:false, wantScreen:false, sound:true,
  rec:null, chunks:[], audioURL:null,
  screenRec:null, screenChunks:[], screenURL:null,
};

/* ---------- 审问话术：三档人设 ----------
   要点：不写「你什么都不懂」（模型会演成笨蛋，只会问"啥意思"），
   而是写「不懂术语但生活经验扎实」——用日常场景怼含糊表述才有杀伤力。 */
const PERSONA = {
  soft:
`你现在扮演一个对这个话题完全没有专业背景的普通人。你很想听懂，态度友好。
规则：
1. 一次只问一个问题，问完等我回答。
2. 不许使用任何专业术语，也不许替我把话说圆。
3. 我用了术语，你就说"这个词我不懂，能换句话说吗"。
4. 一共问我 3 到 4 轮，然后用你自己的话复述一遍你听懂的内容，让我确认对不对。`,
  normal:
`你现在扮演一个对这个话题完全没有专业背景的普通人。你不懂任何术语，但你的生活经验非常扎实。
规则：
1. 一次只问一个问题，问完等我回答，不要一口气抛一串。
2. 不许使用专业术语，不许替我补全逻辑，也不要夸我。
3. 每当我说的话有点含糊，你就用一个具体的生活场景来对照，问它算不算。
4. 至少问一次"所以这个跟我的日常有什么关系"。
5. 一共问 4 到 6 轮。最后用大白话复述你听懂的版本，并直说哪里还是没听明白。`,
  hard:
`你现在扮演一个对这个话题完全没有专业背景、但特别较真的普通人。你不懂术语，可是逻辑很尖。
规则：
1. 一次只问一个问题，问完等我回答。
2. 揪住我用的某一个关键词不放，连着追问，直到我说清它的边界，或者承认自己也说不清。
3. 我一含糊，就用一个具体的生活场景反问，逼我承认那算不算。
4. 我举的例子如果能反过来解释成别的意思，你要指出来。
5. 至少问一次"所以这个跟我有什么关系"，以及一次"这个说法什么情况下不成立"。
6. 一共问 5 到 7 轮。最后直说：我讲的哪一部分你其实没被说服。`,
};

function buildPrompt() {
  const topic = S.topic || '（我刚讲的这个话题）';
  return `${PERSONA[S.level]}

我刚花 ${S.mins.research} 分钟研究了「${topic}」，并且用 ${S.mins.talk} 分钟讲了一遍。
现在开始追问我。请只说第一个问题，不要写开场白，不要复述这些规则。`;
}

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
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- 计时核心 ---------- */
const RING_LEN = 2 * Math.PI * 92;
const LAST = PHASES.length - 1;

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
  $('btn-next').textContent = i < LAST ? '提前进入下一段' : '结束 · 看复盘';
  $('btn-pause').textContent = '暂停';

  // 三张卡：笔记 / 卡壳计数 / 受审
  $('notes-card').classList.toggle('hidden', p.key === 'talk' || p.key === 'grill');
  $('talk-card').classList.toggle('hidden', p.key !== 'talk');
  $('grill-card').classList.toggle('hidden', p.key !== 'grill');

  if (p.key === 'research') {
    $('notes').disabled = false;
    $('notes-label').textContent = '研究笔记';
    $('notes-lock').classList.add('hidden');
  } else if (p.key === 'prep') {
    $('notes').disabled = false;              // 准备阶段仍可整理已有笔记
    $('notes-label').textContent = '整理：把料串成线';
    $('notes-lock').classList.remove('hidden');
  } else if (p.key === 'talk') {
    S.notes = $('notes').value;
    $('notes-peek').textContent = S.notes || '（这场没记笔记）';
    if (S.wantRec) startRec();
  } else {                                     // grill
    $('prompt-box').textContent = buildPrompt();
    syncLevelSeg();
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
    if (S.pi < LAST) enterPhase(S.pi + 1); else finish();
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

/* ---------- 录屏（可选，桌面浏览器；iOS Safari 不支持） ---------- */
async function startScreen() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video:{ frameRate:8 }, audio:false });
    S.screenChunks = [];
    S.screenRec = new MediaRecorder(stream, pickScreenMime());
    S.screenRec.ondataavailable = e => { if (e.data.size) S.screenChunks.push(e.data); };
    S.screenRec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (S.screenChunks.length) {
        S.screenURL = URL.createObjectURL(new Blob(S.screenChunks, { type:S.screenRec.mimeType || 'video/webm' }));
      }
    };
    // 用户从浏览器原生条上点「停止共享」也要收尾
    stream.getVideoTracks()[0].addEventListener('ended', stopScreen);
    S.screenRec.start(1000);
    return true;
  } catch (e) { return false; }
}
function pickScreenMime() {
  const cands = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
  for (const t of cands) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return { mimeType:t };
  }
  return {};
}
function stopScreen() {
  if (S.screenRec && S.screenRec.state !== 'inactive') S.screenRec.stop();
}

/* ---------- 从粘贴的对话里挑出「它问了什么」 ----------
   ChatGPT 复制出来的文本没有稳定结构，所以不靠角色标记，
   只靠「这句是不是问句」+ 去掉明显是我自己说的行。 */
const Q_TAIL = /[?？]\s*$/;
/* 强疑问词：出现在句中任何位置就算提问（中文疑问词常在句中，不在句首）。
   例：「你刚才那个"预示"是什么意思，能不能换句话说。」句末是句号，但它就是个问题。 */
const Q_STRONG = /(为什么|什么|怎么|如何|能不能|算不算|是不是|有没有|多少|凭什么|哪儿|哪里)/;
/* 弱信号：语气词/疑问代词，需要配问号或句末语气词才算，否则容易误收陈述句 */
const Q_WEAK = /(吗|呢|哪|谁|难道)/;
/* 只排除「我：」这种角色标记行，不要用「以我开头」去杀句子——
   AI 自己也会说「我还是没听明白的是，为什么…」，那正是要收的问题。 */
const MINE = /^(我|答|A|Me|User|你)\s*[:：]/i;

function parseQuestions(text) {
  const out = [];
  const seen = new Set();
  text.split(/\n+/).forEach(raw => {
    let line = raw.trim();
    if (!line) return;
    line = line.replace(/^(ChatGPT|GPT|助手|AI|Q|问)\s*[:：]\s*/i, '');
    // 一行里可能有多句，按句末标点切开
    line.split(/(?<=[。！?？!])\s*/).forEach(seg => {
      const s = seg.trim();
      if (s.length < 4 || s.length > 160) return;
      if (MINE.test(s)) return;
      // 三条任一成立即算提问：
      //   a) 句末问号 —— 最硬的信号
      //   b) 句中出现强疑问词 —— 中文疑问词常在句中，句末却是句号
      //   c) 句末语气词 吗/呢 —— 「几次之后我还会紧张吗。」
      const isQ = Q_TAIL.test(s)
        || Q_STRONG.test(s)
        || (Q_WEAK.test(s) && /[吗呢][。！!]?\s*$/.test(s));
      if (!isQ) return;
      const key = s.replace(/\s/g,'');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    });
  });
  return out.slice(0, 20);
}

function syncLevelSeg() {
  document.querySelectorAll('#seg-level .seg-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.lv === S.level);
  });
}

/* ---------- 复盘 ---------- */
function finish() {
  clearInterval(S.timer);
  stopRec(); stopScreen();
  if (PHASES[S.pi].key !== 'grill') S.notes = $('notes').value;
  S.dialogue = $('dialogue').value;
  S.questions = parseQuestions(S.dialogue);
  S.answered = {};

  const total = Object.values(S.tally).reduce((a,b) => a+b, 0);
  const words = S.notes.replace(/\s/g,'').length;

  $('done-topic').textContent = S.topic || '未命名的一场';
  $('done-when').textContent =
    new Date(S.startedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
    + ` · ${S.mins.research}/${S.mins.prep}/${S.mins.talk}/${S.mins.grill} 分钟`;
  $('s-total').textContent = total;
  $('s-words').textContent = words;
  $('s-ask').textContent = S.questions.length;

  const max = Math.max(1, ...Object.values(S.tally));
  $('bars').innerHTML = Object.keys(TALLY_LABEL).map(k => `
    <div class="bar-row">
      <span>${TALLY_LABEL[k]}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${S.tally[k]/max*100}%"></div></div>
      <em>${S.tally[k]}</em>
    </div>`).join('');

  renderQA();
  $('verdict').textContent = verdict(total, words, S.questions.length);
  $('notes-dump').textContent = S.notes || '（这场没记笔记）';

  if (S.audioURL) { $('player').src = S.audioURL; $('audio-card').classList.remove('hidden'); }
  else $('audio-card').classList.add('hidden');

  if (S.screenURL) {
    $('screen-link').href = S.screenURL;
    $('screen-link').download = `pitch-${S.startedAt}.webm`;
    $('screen-card').classList.remove('hidden');
  } else $('screen-card').classList.add('hidden');

  saveHistory({
    topic:S.topic, at:S.startedAt, tally:{...S.tally}, total, words,
    talk:S.talkSpent, asked:S.questions.length, level:S.level,
  });
  show('view-done');
}

/* 问题清单：勾掉答得上的，剩下的就是欠账 */
function renderQA() {
  const has = S.questions.length > 0;
  $('qa-card').classList.toggle('hidden', !has);
  if (!has) return;
  $('qa-list').innerHTML = S.questions.map((q, i) => `
    <label class="qa-item">
      <input type="checkbox" data-qi="${i}">
      <span>${esc(q)}</span>
    </label>`).join('');
  document.querySelectorAll('#qa-list input').forEach(cb => {
    cb.onchange = () => { S.answered[cb.dataset.qi] = cb.checked; paintQATip(); };
  });
  paintQATip();
}
function paintQATip() {
  const ok = Object.values(S.answered).filter(Boolean).length;
  const n = S.questions.length;
  const owe = n - ok;
  $('qa-tip').textContent = owe === 0
    ? `${n} 个问题全接住了。下次把强度调高一档。`
    : `还欠 ${owe} 个答不上的。这 ${owe} 个就是下一场的研究清单——比任何笔记都准。`;
}

function verdict(total, words, asked) {
  const parts = [];
  if (total === 0 && words > 0) parts.push('一次没卡。要么你本来就熟，要么下次把呈现时间砍一半再试。');
  else if (total <= 2) parts.push('讲得稳。卡壳少通常不是嘴的功劳，是准备阶段真的把线串起来了。');
  else if (total <= 5) parts.push('正常水位。卡住的地方大多是你抄下来但没用自己的话重写过的那几条。');
  else parts.push('卡得多说明还停在「知识点」阶段，没变成「知识面」。');

  if (asked === 0) parts.push('这场没留下追问记录——被外行问住的地方才是真漏洞，下次记得把对话粘回来。');
  else if (asked <= 3) parts.push(`它只问出 ${asked} 个问题，可能是你讲得清楚，也可能是它太客气。试试把强度调到「杠精」。`);
  else parts.push(`被追问 ${asked} 次。勾一下哪些答上了，答不上的那几个就是你以为自己懂了的部分。`);
  return parts.join('');
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
        <small>${new Date(r.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · 笔记 ${r.words} 字 · 被问 ${r.asked || 0}</small>
      </div>
      <div class="hist-n">失误 ${r.total}</div>
    </div>`).join('');
}

/* ---------- 下次提醒：生成 .ics 交给系统日历 ----------
   网页在标签页关掉后无法弹通知（那需要服务端推送），
   所以把提醒交给系统日历，反而更可靠。 */
function icsEscape(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
}
function icsStamp(d) {
  return d.getUTCFullYear()
    + String(d.getUTCMonth()+1).padStart(2,'0')
    + String(d.getUTCDate()).padStart(2,'0') + 'T'
    + String(d.getUTCHours()).padStart(2,'0')
    + String(d.getUTCMinutes()).padStart(2,'0')
    + String(d.getUTCSeconds()).padStart(2,'0') + 'Z';
}
function downloadICS() {
  const owe = S.questions.filter((q,i) => !S.answered[i]);
  const start = new Date(Date.now() + 24*3600*1000);
  const span = (S.mins.research + S.mins.prep + S.mins.talk + S.mins.grill) * 60000;
  const body = [
    `再讲一遍「${S.topic || '上次那个题'}」，对比卡壳次数。`,
    owe.length ? `上次答不上的：` : `上次全接住了，这次把强度调高一档。`,
    ...owe.map((q,i) => `${i+1}. ${q}`),
  ].join('\n');

  const ics = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//pitch2051//ZH',
    'BEGIN:VEVENT',
    `UID:pitch2051-${S.startedAt}@local`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(new Date(start.getTime() + span))}`,
    `SUMMARY:${icsEscape('复讲：' + (S.topic || '未命名'))}`,
    `DESCRIPTION:${icsEscape(body)}`,
    'BEGIN:VALARM','TRIGGER:-PT10M','ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape('十分钟后开讲')}`,
    'END:VALARM','END:VEVENT','END:VCALENDAR',
  ].join('\r\n');

  const url = URL.createObjectURL(new Blob([ics], { type:'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `复讲-${S.topic || '未命名'}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  $('btn-ics').textContent = '已生成 .ics，导入日历即可';
  setTimeout(() => { $('btn-ics').textContent = '下次提醒我（加入日历）'; }, 2600);
}

/* ---------- 事件绑定 ---------- */
$('btn-start').onclick = async () => {
  const g = (id, d, lo, hi) => {
    const v = parseInt($(id).value, 10);
    return (isNaN(v) || v < lo || v > hi) ? d : v;
  };
  S.topic = $('topic').value.trim();
  S.mins = {
    research:g('m-research',20,1,120), prep:g('m-prep',5,1,60),
    talk:g('m-talk',1,1,30), grill:g('m-grill',5,1,60),
  };
  S.level = $('level').value;
  S.wantRec = $('opt-rec').checked;
  S.wantScreen = $('opt-screen').checked;
  S.sound = $('opt-sound').checked;
  S.tally = { stuck:0, slur:0, drift:0, filler:0 };
  S.talkSpent = 0; S.notes = ''; S.audioURL = null; S.screenURL = null;
  S.dialogue = ''; S.questions = []; S.answered = {};
  S.startedAt = Date.now();

  $('notes').value = '';
  $('dialogue').value = '';
  $('dlg-count').textContent = '0 轮追问';
  $('note-count').textContent = '0 字';
  Object.keys(TALLY_LABEL).forEach(k => { $('c-'+k).textContent = '0'; });
  $('rec-state').textContent = S.wantRec ? '呈现时开始录音' : '未录音';
  $('run-topic').textContent = S.topic || '未命名的一场';

  if (S.sound) beep(1);            // 顺带解锁 iOS 音频上下文
  show('view-run');
  enterPhase(0);
  // 录屏要在用户手势里发起，所以放在 start 里，不等到呈现阶段
  if (S.wantScreen) {
    const ok = await startScreen();
    if (!ok) $('rec-state').textContent = '录屏没能开始（手机浏览器不支持，或你取消了）';
  }
};

$('btn-pause').onclick = () => {
  S.paused = !S.paused;
  document.body.classList.toggle('paused', S.paused);
  $('btn-pause').textContent = S.paused ? '继续' : '暂停';
};

$('btn-next').onclick = () => {
  if (S.pi < LAST) { if (S.pi < 2) S.notes = $('notes').value; beep(1); enterPhase(S.pi + 1); }
  else finish();
};

$('btn-abort').onclick = () => {
  if (!confirm('放弃这一场？记录不会保存。')) return;
  clearInterval(S.timer); stopRec(); stopScreen();
  document.body.classList.remove('warn','paused');
  renderHistory(); show('view-setup');
};

$('notes').oninput = e => {
  $('note-count').textContent = e.target.value.replace(/\s/g,'').length + ' 字';
};

$('dialogue').oninput = e => {
  const n = parseQuestions(e.target.value).length;
  $('dlg-count').textContent = n + ' 轮追问';
};

document.querySelectorAll('.tally').forEach(b => {
  b.onclick = () => {
    const k = b.dataset.k;
    S.tally[k]++; $('c-'+k).textContent = S.tally[k];
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 220);
    if (navigator.vibrate) navigator.vibrate(18);
  };
});

document.querySelectorAll('#seg-level .seg-btn').forEach(b => {
  b.onclick = () => {
    S.level = b.dataset.lv;
    $('level').value = S.level;
    syncLevelSeg();
    $('prompt-box').textContent = buildPrompt();
  };
});

$('btn-copy-prompt').onclick = async () => {
  try {
    await navigator.clipboard.writeText(buildPrompt());
    $('btn-copy-prompt').textContent = '已复制';
  } catch (e) { $('btn-copy-prompt').textContent = '复制失败，手动选中'; }
  setTimeout(() => { $('btn-copy-prompt').textContent = '复制话术'; }, 1800);
};

$('btn-again').onclick = () => { renderHistory(); show('view-setup'); };
$('btn-ics').onclick = downloadICS;

$('btn-copy').onclick = async () => {
  const owe = S.questions.filter((q,i) => !S.answered[i]);
  const lines = [
    `【${S.topic || '未命名'}】${S.mins.research}/${S.mins.prep}/${S.mins.talk}/${S.mins.grill} 分钟`,
    ...Object.keys(TALLY_LABEL).map(k => `${TALLY_LABEL[k]}：${S.tally[k]}`),
    `实际讲了 ${S.talkSpent} 秒 · 被追问 ${S.questions.length} 次`,
    '',
    owe.length ? '答不上的（下一场的研究清单）：' : '追问全接住了。',
    ...owe.map((q,i) => `${i+1}. ${q}`),
    '', '笔记：', S.notes || '（无）',
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
      && PHASES[S.pi].key === 'talk'
      && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    document.querySelector('.tally[data-k=stuck]').click();
  }
});

window.addEventListener('beforeunload', e => {
  if (!$('view-run').classList.contains('hidden')) { e.preventDefault(); e.returnValue = ''; }
});

renderHistory();
