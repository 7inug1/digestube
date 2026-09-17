"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { browserClient } from "@/lib/auth/client";
import { saySorry } from "@/lib/errors";

/** 비밀번호 없이 메일로 온 링크를 눌러 들어온다. 외울 것도, 잊을 것도 없다. */
export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const params = useSearchParams();

  async function send() {
    const to = email.trim();
    if (!to) return;
    setState("sending");
    // 운영 링크가 Supabase 의 localhost Site URL 로 되돌아가지 않도록 배포 주소를
    // 명시한다. 로컬에서는 환경변수를 비워 현재 origin 을 그대로 쓴다.
    const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || location.origin;
    const { error } = await browserClient().auth.signInWithOtp({
      email: to,
      options: { emailRedirectTo: new URL("/auth/callback", site).toString() },
    });
    if (error) {
      setState("error");
      if (error.code === "over_email_send_rate_limit") {
        setMsg("로그인 메일 발송 한도에 도달했어요. 한 시간 뒤 다시 시도해 주세요.");
      } else if (error.code === "email_address_not_authorized") {
        setMsg("현재는 등록된 테스트 이메일로만 로그인할 수 있어요.");
      } else {
        setMsg(saySorry(error, "login"));
      }
      return;
    }
    setState("sent");
  }

  return (
    <div className="mx-auto max-w-[400px] py-16 text-center">
      <p className="mb-2 text-[22px] font-[740] tracking-[-.03em] sm:text-[28px]">로그인</p>
      <p className="mb-8 text-small text-mfg">
        이메일로 로그인 링크를 보내드려요.<br />비밀번호는 없어요.
      </p>

      {state === "sent" ? (
        <div className="rounded-xl border border-line p-5 text-left">
          <p className="mb-1 font-semibold">메일을 보냈어요</p>
          <p className="text-small text-mfg">
            <span className="font-medium text-fg">{email}</span>로 온 링크를 눌러주세요.
            안 보이면 스팸함도 확인해 주세요.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input type="email" value={email} autoComplete="email" autoFocus
              disabled={state === "sending"} aria-label="이메일"
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="이메일 주소"
              className="h-[46px] min-w-0 flex-1 rounded-lg border border-line bg-muted/50 px-3.5 outline-none placeholder:text-mfg focus:border-fg focus:bg-bg" />
            <button onClick={send} disabled={!email.trim() || state === "sending"}
              className="h-[46px] shrink-0 whitespace-nowrap rounded-lg bg-fg px-4 text-small font-semibold text-bg disabled:opacity-35 sm:px-5">
              {state === "sending" ? "보내는 중…" : "링크 받기"}
            </button>
          </div>
          {(state === "error" || params.get("error") === "link") && (
            <p role="status" className="mt-3 text-small text-mfg">
              {state === "error" ? msg : "링크가 만료됐거나 이미 쓰였어요. 다시 받아주세요."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
