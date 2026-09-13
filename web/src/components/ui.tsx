/** v1 랜딩에서 쓰던 조각들. 판단이 아니라 표현이라 그대로 가져왔다. */
import type {ReactNode} from "react";

/* 11px + uppercase + 넓은 자간은 라틴 문자용 라벨 관습이다. 한글엔 대문자가 없어
   uppercase 는 아무 일도 안 하고, 넓은 자간은 한글 가독성을 떨어뜨리기만 한다.
   한글에선 크기·굵기·색으로 라벨임을 알린다.
   크기는 화면 폭을 안 탄다 — KRDS 도 제목만 모바일에서 줄이고 본문·작은 글자는 양쪽 같다. */
export const Label = ({children}: {children: ReactNode}) => (
  <span className="text-small font-medium tracking-[-.01em] text-mfg">{children}</span>
);

/* 제목이 그림 위에 올 때도 있고 아래에 올 때도 있어서 따로 뺐다. */
export const SecTitle = ({children, className = ""}: {children: ReactNode; className?: string}) => (
  <h2 className={`mx-auto max-w-[22ch] text-title font-[660] tracking-[-.035em] ${className}`}>
    {children}
  </h2>
);

export const Sec = ({label, title, children}: {label?: string; title?: string; children: ReactNode}) => (
  <section className="pb-4 pt-10 text-center">
    {label && <div className="mb-3"><Label>{label}</Label></div>}
    {title && <SecTitle className="mb-8">{title}</SecTitle>}
    {children}
  </section>
);

export const ClockIcon = ({className = ""}: {className?: string}) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
    <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.8" />
  </svg>
);
