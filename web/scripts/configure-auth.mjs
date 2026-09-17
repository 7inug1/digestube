/** 운영 Auth URL과 매직링크 메일을 Supabase hosted project에 적용한다.
 *
 * SUPABASE_ACCESS_TOKEN=... node --env-file=.env.local scripts/configure-auth.mjs
 */
import {readFile} from "node:fs/promises";

const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const projectUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.trim();
if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN이 필요합니다.");
if (!projectUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_URL이 필요합니다.");

const projectRef = new URL(projectUrl).hostname.split(".")[0];
if (!projectRef) throw new Error("Supabase project ref를 찾지 못했습니다.");

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const headers = {Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json"};
const currentResponse = await fetch(endpoint, {headers});
if (!currentResponse.ok) {
  throw new Error(`현재 Auth 설정 조회 실패: ${currentResponse.status} ${await currentResponse.text()}`);
}
const current = await currentResponse.json();
const redirects = new Set(
  String(current.uri_allow_list ?? "").split(",").map((url) => url.trim()).filter(Boolean),
);
redirects.add("https://digestube.vercel.app/auth/callback");
redirects.add("http://localhost:3000/auth/callback");

const template = await readFile(new URL("../supabase/templates/magic-link.html", import.meta.url), "utf8");
const urlConfig = {
  site_url: "https://digestube.vercel.app",
  uri_allow_list: [...redirects].join(","),
};
const update = (body) => fetch(endpoint, {
  method: "PATCH",
  headers,
  body: JSON.stringify(body),
});

let updateResponse = await update({
  ...urlConfig,
  mailer_subjects_magic_link: "Digestube 로그인 링크",
  mailer_templates_magic_link_content: template,
});
let templateApplied = updateResponse.ok;
if (!updateResponse.ok) {
  const detail = await updateResponse.text();
  const templateBlocked = updateResponse.status === 400
    && detail.includes("Email template modification is not available for free tier projects");
  if (!templateBlocked) {
    throw new Error(`Auth 설정 적용 실패: ${updateResponse.status} ${detail}`);
  }

  // 기본 메일 공급자를 쓰는 Free 프로젝트는 템플릿 변경을 막는다. URL 설정은 별도로 적용한다.
  updateResponse = await update(urlConfig);
  if (!updateResponse.ok) {
    throw new Error(`Auth URL 설정 적용 실패: ${updateResponse.status} ${await updateResponse.text()}`);
  }
  templateApplied = false;
}

console.log("Supabase Auth 설정을 적용했습니다.");
console.log("Site URL: https://digestube.vercel.app");
console.log("Redirect URLs:", [...redirects].join(", "));
console.log(templateApplied
  ? "Magic Link template: Digestube 템플릿 적용"
  : "Magic Link template: 미적용 (Free 기본 SMTP 제한 — Custom SMTP 연결 필요)");
