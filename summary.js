// 要点リスト: 文字起こしを Claude に読ませて、要点・決まったこと・やること・保留をまとめる
// API キーは利用者の端末にだけ保存し、ブラウザから Anthropic に直接送る

const MODEL = 'claude-opus-5-5';

const SYSTEM = `あなたは打ち合わせ・会議や、音楽のレッスン・稽古の記録係です。
音声認識による文字起こしを読み、あとで見返す人のために要点を日本語でまとめます。

- 文字起こしには誤認識や言いよどみが含まれます。前後の文脈から本来の意味を汲み取ってください。
  固有名詞・曲名・音楽用語が崩れていそうなら、自然な表記に直してかまいません。
- 「★」で始まる行は、記録している人が大事だと印を付けた箇所です。その前後の発言を優先して拾ってください。
- 各項目は1文で短く。話していないことは書きません。
- 項目ごとに、関係する発言の経過時間を at に入れます(文字起こしの [12:34] の形のうち 12:34 の部分)。

分け方:
- points: 話の要点
- decisions: 決まったこと・先生や演出からの指示(「ここはこう弾く」「テンポは96」など)
- todos: これからやること・練習すること(誰が・いつまでに、が分かれば添える)
- questions: 結論が出ていないこと・あとで確認すること`;

const item = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'at'],
  properties: {
    text: { type: 'string' },
    at: { type: 'string', description: '関係する発言の経過時間(例 12:34)。分からなければ空文字' },
  },
};
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['points', 'decisions', 'todos', 'questions'],
  properties: {
    points: { type: 'array', items: item },
    decisions: { type: 'array', items: item },
    todos: { type: 'array', items: item },
    questions: { type: 'array', items: item },
  },
};

export const SECTIONS = [
  ['points', '要点'],
  ['decisions', '決まったこと・指示'],
  ['todos', 'やること'],
  ['questions', '保留・確認すること'],
];

let sdk = null;
async function client(apiKey) {
  // SDK は同梱のもの(vendor/)を、使うときにだけ読み込む
  sdk ??= (await import('./vendor/anthropic-sdk.js')).default;
  return new sdk({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120_000 });
}

// 文字起こしを、前回までに送った区切り(chunks)ごとのブロックに分けて送る。
// 前回までのブロックは中身が変わらないので、Anthropic 側の控え(プロンプトキャッシュ)が効いて安く速くなる
function transcriptBlocks(session, fmt) {
  const lines = session.lines;
  const sum = session.summary;
  let ends = (sum?.chunks || []).filter((e) => e <= lines.length);
  if (ends.length !== (sum?.chunks || []).length) ends = []; // 行が消えたなどで区切りが合わない
  if (!ends.length || ends.at(-1) < lines.length) ends = [...ends, lines.length];
  const blocks = [];
  let start = 0;
  for (const end of ends) {
    const text = lines.slice(start, end).map((l) => `[${fmt(l.t)}] ${l.text}`).join('\n');
    blocks.push({ type: 'text', text: (start === 0 ? '文字起こし:\n' : '') + text + '\n' });
    start = end;
  }
  blocks.at(-1).cache_control = { type: 'ephemeral' };
  return { blocks, ends };
}

export function buildRequest(session, fmt) {
  const { blocks, ends } = transcriptBlocks(session, fmt);
  const prev = session.summary;
  const instruction = prev?.points
    ? '前回まとめた要点リストは次のとおりです。新しく加わった発言を反映して、リスト全体を更新してください。'
      + '内容が変わらない項目は、言い回しも順番も変えないでください(画面で読んでいる人が迷わないように)。\n'
      + JSON.stringify(Object.fromEntries(SECTIONS.map(([k]) => [k, prev[k] || []])))
    : '要点リストを作ってください。';
  const title = session.title ? `記録の名前: ${session.title}\n` : '';
  return {
    ends,
    params: {
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      // 断られたときは、内容に合った別のモデルでサーバー側が自動でやり直す
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // その場で更新したいので、考える量は少なめにして速さを優先する
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text: title + instruction }] }],
    },
  };
}

export async function summarize(session, apiKey, fmt, signal) {
  const { params, ends } = buildRequest(session, fmt);
  let res;
  try {
    const anthropic = await client(apiKey);
    res = await anthropic.beta.messages.create(params, { signal });
  } catch (err) {
    throw new Error(explain(err, sdk));
  }
  if (res.stop_reason === 'refusal') throw new Error('この内容は要点にできませんでした。');
  if (res.stop_reason === 'max_tokens') throw new Error('要点が長くなりすぎて途中で切れました。');
  const text = res.content.find((b) => b.type === 'text')?.text;
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('要点の形が崩れていました。もう一度更新してください。'); }
  return { ...data, chunks: ends, linesCovered: session.lines.length, updatedAt: Date.now() };
}

function explain(err, A) {
  if (!A) return '要点を作る部品を読み込めませんでした。通信状態を確かめて、ページを開き直してください。';
  if (err?.name === 'AbortError' || err instanceof A.APIUserAbortError) return '中止しました。';
  if (err instanceof A.AuthenticationError) return 'API キーが正しくありません。⚙ 設定で確かめてください。';
  if (err instanceof A.PermissionDeniedError) return 'この API キーでは使えません(権限・利用上限を確かめてください)。';
  if (err instanceof A.RateLimitError) return '混み合っています。少し待ってから自動でやり直します。';
  if (err instanceof A.APIConnectionError) return '通信できませんでした。電波の状態を確かめてください。';
  if (err instanceof A.APIError) {
    if (err.status === 400 && /credit|balance/i.test(err.message)) return 'API の残高が足りません。';
    if (err.status >= 500) return 'Claude 側で一時的なエラーが起きました。少し待ってからやり直します。';
    return `要点を作れませんでした(${err.status ?? ''} ${err.message})`;
  }
  return `要点を作れませんでした(${err?.message || err})`;
}
