// 커밋 메시지 형식 검사 — 한국어 제목, 명사형 종결, 본문은 소제목 + "- " 불릿.
//
//   node scripts/check-commit-msg.mjs <메시지 파일>     # commit-msg hook
//   node scripts/check-commit-msg.mjs --range A..B      # CI: 범위 안의 커밋 전부
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TYPES = 'feat|fix|refactor|docs|style|test|chore|ci|perf|build|revert|merge';
const TITLE = new RegExp(`^(${TYPES})(\\([^)]+\\))?: (.+)$`);
// "필요", "개요" 같은 명사는 통과시키고 문장형 어미만 잡는다.
const SENTENCE_END = /(다|니다|에요|예요|해요|어요|아요|네요|세요|죠)[.!?)"'」]*$/;
const TITLE_END = /(다|니다|에요|예요|해요|어요|아요|네요|세요|죠|게|\.)$/;
const HANGUL = /[가-힣]/;
const HEADING_MAX = 40;

export function checkMessage(message) {
  const problems = [];
  const lines = [];
  for (const line of message.split('\n')) {
    if (/^# -+ >8 -+$/.test(line)) break; // git commit -v 의 가위 줄
    lines.push(line);
  }

  const title = lines[0] ?? '';
  const m = title.match(TITLE);
  if (!m) problems.push(`1줄 제목: 타입 접두어 필요 (${TYPES.replaceAll('|', ', ')}: …) — "${title}"`);
  else {
    const subject = m[3].trim();
    if (!HANGUL.test(subject)) problems.push(`1줄 제목: 한국어로 작성 — "${subject}"`);
    if (TITLE_END.test(subject)) problems.push(`1줄 제목: 명사형 종결 (~수정, ~추가, ~없음) — "${subject}"`);
  }

  lines.forEach((line, i) => {
    const n = i + 1;
    if (n === 1 || line.startsWith('#') || !line.trim()) return;
    const text = line.trimEnd();
    if (/^co-authored-by:/i.test(text)) { problems.push(`${n}줄: Co-Authored-By trailer 넣지 않음`); return; }
    if (SENTENCE_END.test(text)) { problems.push(`${n}줄: 명사형 종결 (~다·~요 금지) — "${text.trim()}"`); return; }
    if (/^\s/.test(line)) return; // 불릿 이어짐·코드 예시
    if (/[^.]\.$/.test(text)) { problems.push(`${n}줄: 끝 마침표 빼기 — "${text}"`); return; }
    if (!text.startsWith('- ') && text.length > HEADING_MAX) {
      problems.push(`${n}줄: 문단 대신 짧은 소제목 + "- " 불릿 (${HEADING_MAX}자 이하) — "${text}"`);
    }
  });
  return problems;
}

function main(args) {
  let failed = 0;
  const report = (label, message) => {
    const problems = checkMessage(message);
    if (!problems.length) return;
    failed++;
    console.error(`✖ ${label}`);
    for (const p of problems) console.error(`  ${p}`);
  };

  if (args[0] === '--range') {
    const commits = execFileSync('git', ['rev-list', '--reverse', args[1]], { encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const c of commits) report(c.slice(0, 7), execFileSync('git', ['log', '-1', '--format=%B', c], { encoding: 'utf8' }));
  } else if (args[0]) {
    report('커밋 메시지', readFileSync(args[0], 'utf8'));
  } else {
    console.error('사용법: check-commit-msg.mjs <메시지 파일> | --range A..B');
    return 2;
  }
  if (failed) console.error('\n형식: "fix: 한국어 요약" / 본문은 소제목 + "- " 불릿, 명사형 종결 (예: "fix: 검색 기준값 수정")');
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
