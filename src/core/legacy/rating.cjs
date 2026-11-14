'use strict';
/**
 * electron/core/rating.cjs
 * ---------------------------------------------------------------------------
 * 年龄分级判定：从图片元数据里读分级词/内容词，映射到 l0–l4。
 *
 * 档位表（按使用方给定口径）：
 *   l0 全年龄  / sfw        / Danbooru s  无裸露、无性暗示、无血腥
 *   l1 暗示    / suggestive / Danbooru q  泳装、内衣、露沟、露肩、湿衣、高开叉，无露点
 *   l2 露骨    / explicit   / Danbooru e  露点、全裸、透视、半裸、脱衣
 *   l3 硬核    / hardcore   / Danbooru e  性行为、性道具、束缚调教、体液
 *   l4 极端    / extreme    / Danbooru e  群体、扩张、极端插入、血腥 Guro
 *
 * 两条判定依据，取较高者（宁可多屏蔽，可在 UI 手动改）：
 *   1) 元数据里显式的分级标记（rating:q / nsfwLevel=16 / content_rating=explicit …）
 *   2) 正向前提词里的内容词（词典见下）
 *
 * 关键防呆：**负向提示词必须排除**。A1111 用户常把 nsfw / nude / nipples
 * 写进 Negative prompt 表示"不要"，若一并扫描会把图误判成高分级。
 */

const LEVELS = [
  { level: 0, key: 'l0', name: '全年龄', en: 'sfw', danbooru: 's' },
  { level: 1, key: 'l1', name: '暗示', en: 'suggestive', danbooru: 'q' },
  { level: 2, key: 'l2', name: '露骨', en: 'explicit', danbooru: 'e' },
  { level: 3, key: 'l3', name: '硬核', en: 'hardcore', danbooru: 'e' },
  { level: 4, key: 'l4', name: '极端', en: 'extreme', danbooru: 'e' }
];

const LEVEL_BY_KEY = new Map(LEVELS.map((l) => [l.key, l]));

/** 内容词词典；长词优先匹配，避免 "sex" 撞上 "sexy" */
const LEXICON = {
  1: [
    // 英文 / Danbooru 标签
    'bikini', 'swimsuit', 'one-piece swimsuit', 'school swimsuit', 'underwear', 'panties',
    'bra', 'lingerie', 'garter belt', 'cleavage', 'sideboob', 'underboob', 'cameltoe',
    'pantyshot', 'upskirt', 'revealing clothes', 'revealing outfit', 'wet clothes',
    'wet shirt', 'see-through', 'suggestive', 'sexy', 'sexualized', 'seductive',
    'high slit', 'bare shoulders', 'off shoulder', 'midriff', 'navel',
    // 中文
    '泳装', '比基尼', '内衣', '内裤', '胸罩', '情趣内衣', '露沟', '露肩', '湿衣',
    '高开叉', '开叉裙', '性感', '诱惑', '擦边', '暗示', '露脐', '吊带'
  ],
  2: [
    'nude', 'nudity', 'naked', 'nipples', 'nipple', 'areola', 'areolae', 'topless',
    'bottomless', 'pussy', 'penis', 'breasts out', 'no bra', 'undressing', 'undressed',
    'completely nude', 'full nude', 'exposed breasts', 'exposed genitals',
    // 中文
    '全裸', '裸体', '裸露', '露点', '乳头', '半裸', '脱衣', '透视', '露乳',
    '一丝不挂', '露阴', '生殖器', '赤身'
  ],
  3: [
    'sex', 'sexual intercourse', 'vaginal', 'anal', 'oral', 'fellatio', 'cunnilingus',
    'cum', 'cumshot', 'ejaculation', 'semen', 'penetration', 'intercourse',
    'bondage', 'bdsm', 'shibari', 'bondage rope', 'sex toy', 'dildo', 'vibrator',
    'masturbation', 'tentacle', 'tentacles', 'squirting',
    // 中文
    '性交', '性行为', '性道具', '束缚', '调教', '捆绑', '体液', '精液', '潮吹',
    '触手', '插入', '口交', '肛交', '自慰', '调教束缚'
  ],
  4: [
    'guro', 'gore', 'ryona', 'amputation', 'dismemberment', 'gangbang', 'group sex',
    'orgy', 'bukkake', 'vore', 'scat', 'inflation', 'expansion', 'extreme penetration',
    'blood', 'bloody', 'corpse', 'necro',
    // 中文
    '血腥', '猎奇', '肢解', '断肢', '群体', '群交', '多人', '扩张', '极端插入',
    '内脏', '虐杀', '尸体'
  ]
};

/** 显式分级标记 → 基础档位 */
const EXPLICIT_TOKENS = [
  { re: /(?:^|[^a-z])rating\s*[:=]\s*([sqe])(?![a-z])/, map: { s: 0, q: 1, e: 2 } },
  { re: /(?:^|[^a-z])content[_\s-]?rating\s*[:=]\s*([a-z0-9_-]+)/, map: null },
  { re: /(?:^|[^a-z])nsfw[_\s-]?level\s*[:=]\s*(\d+)/, map: 'civitai' },
  { re: /(?:^|[^a-z])nsfw\s*[:=]\s*(true|1|yes)(?![a-z])/, map: { true: 1 } }
];

const WORD_TO_LEVEL = [
  [/^(sfw|safe|general|all[-_]?ages|全年龄|安全)$/, 0],
  [/^(suggestive|questionable|擦边)$/, 1],
  [/^(explicit|露骨)$/, 2],
  [/^(hardcore|硬核)$/, 3],
  [/^(extreme|极端)$/, 4]
];

const CJK_RE = /[\u3400-\u9fff]/;

/** 去掉 (xxx:1.2) 权重、<lora:name:0.8> 标签、:: 转义 */
function stripPromptDecorations(text) {
  return String(text || '')
    .replace(/<(?:lora|lyco|hypernet|embedding):[^>]*>/gi, ' ')
    .replace(/\(([^()]*?):\s*-?[\d.]+\)/g, ' $1 ')
    .replace(/[{}\[\]]/g, ' ')
    .replace(/\\([()])/g, '$1')
    .replace(/::/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 只保留正向提示词：优先用已解析的 positive，否则按 A1111 分隔符切掉负向段 */
function positiveTextFromMetadata(meta) {
  if (!meta) return '';
  if (typeof meta.positive === 'string' && meta.positive.trim()) return meta.positive;

  const raw = typeof meta.parameters === 'string' ? meta.parameters : '';
  if (!raw) {
    // ComfyUI：prompt 是 JSON，取其文本字段
    if (meta.prompt_parsed) return String(meta.prompt_parsed);
    return '';
  }

  let body = raw;
  const negIdx = body.indexOf('Negative prompt:');
  if (negIdx !== -1) body = body.slice(0, negIdx);
  // 去掉末尾的 "Steps: ..." 参数行
  const lines = body.split('\n');
  const lastLine = lines[lines.length - 1] || '';
  if (/^Steps:\s*\d+/i.test(lastLine.trim())) lines.pop();
  return lines.join('\n');
}

function tokenize(text) {
  const norm = String(text || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  return { norm, tokens: new Set(norm.split(' ').filter(Boolean)) };
}

function termHit(term, tokens, norm) {
  if (CJK_RE.test(term)) return norm.includes(term);
  const words = term.split(' ');
  if (words.length === 1) {
    return tokens.has(term) || tokens.has(`${term}s`) || tokens.has(`${term}es`);
  }
  return norm.includes(term);
}

/**
 * 从元数据判定分级。
 * @param {object} meta readMetadata 的返回值
 * @returns {{level:number|null,key:string|null,name:string|null,danbooru:string|null,
 *            source:'explicit'|'keyword'|'mixed'|'none',
 *            matched:Array<{term:string,level:number}>, text:string}}
 */
function classifyMetadata(meta) {
  const text = stripPromptDecorations(positiveTextFromMetadata(meta));
  const { tokens, norm } = tokenize(text);
  // 显式标记要在"未分词"的原文上匹配：tokenize 会把 rating:e 的冒号吃掉
  const raw = text.toLowerCase();
  const matched = [];

  // 1) 显式分级标记
  let explicitLevel = null;
  for (const { re, map } of EXPLICIT_TOKENS) {
    const m = re.exec(raw);
    if (!m) continue;
    const value = (m[1] || '').trim();
    if (map === 'civitai') {
      // Civitai nsfwLevel 位掩码：1 PG / 2 PG-13 / 4 R / 8 X / 16 XXX
      const n = parseInt(value, 10);
      const table = { 1: 0, 2: 1, 4: 1, 8: 2, 16: 3, 32: 4 };
      if (Number.isFinite(n) && table[n] !== undefined) explicitLevel = table[n];
    } else if (map && map[value] !== undefined) {
      explicitLevel = map[value];
    } else if (!map) {
      const vocab = { sfw: 0, safe: 0, general: 0, suggestive: 1, questionable: 1, explicit: 2, hardcore: 3, extreme: 4 };
      if (vocab[value] !== undefined) explicitLevel = vocab[value];
    }
    if (explicitLevel !== null) {
      matched.push({ term: `rating:${value}`, level: explicitLevel });
      break;
    }
  }

  // 2) 内容词（l4 → l1 逆序，命中即记，最终取最高）
  for (let level = 4; level >= 1; level--) {
    for (const term of LEXICON[level]) {
      if (termHit(term, tokens, norm)) {
        matched.push({ term, level });
      }
    }
  }

  // 3) 独立的 sfw 声明：只有在没有任何高等级信号时才生效
  if (explicitLevel === null && tokens.has('sfw')) {
    matched.push({ term: 'sfw', level: 0 });
    explicitLevel = 0;
  }
  if (explicitLevel === null) {
    for (const [re, lvl] of WORD_TO_LEVEL) {
      if (lvl === 0) continue;
      for (const t of tokens) {
        if (re.test(t)) {
          matched.push({ term: t, level: lvl });
          if (explicitLevel === null || lvl > explicitLevel) explicitLevel = lvl;
        }
      }
    }
  }

  const keywordLevel = matched.reduce((max, m) => (m.level > max ? m.level : max), -1);
  const candidates = [explicitLevel, keywordLevel >= 0 ? keywordLevel : null].filter((v) => v !== null);
  const level = candidates.length > 0 ? Math.max(...candidates) : null;

  const hasExplicit = explicitLevel !== null && matched.some((m) => m.term.startsWith('rating:') || m.term === 'sfw');
  const hasKeyword = matched.some((m) => !m.term.startsWith('rating:') && m.term !== 'sfw');
  const source = hasExplicit && hasKeyword ? 'mixed' : hasExplicit ? 'explicit' : hasKeyword ? 'keyword' : 'none';

  const meta0 = level === null ? null : LEVELS[level];
  return {
    level,
    key: meta0 ? meta0.key : null,
    name: meta0 ? meta0.name : null,
    danbooru: meta0 ? meta0.danbooru : null,
    source,
    matched: matched.slice(0, 12),
    text: text.slice(0, 400)
  };
}

/** 供 UI 用的档位表 */
function listLevels() {
  return LEVELS.map((l) => ({ ...l }));
}

module.exports = {
  LEVELS,
  LEVEL_BY_KEY,
  classifyMetadata,
  listLevels,
  positiveTextFromMetadata,
  stripPromptDecorations
};
