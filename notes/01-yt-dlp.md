# yt-dlp (오디오 추출)

상태: 완료

**결론: yt-dlp 채택. youtube-dl·pytube·pytubefix 세 후보 모두 자동화된 파이프라인에 넣기엔 부족했다.**

| 도구 | 저장소 | 최근 릴리스 | 월 다운로드(PyPI) | 봇 차단 우회 | 자동화 가능 |
|---|---|---|---|:---:|:---:|
| **yt-dlp** | [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | 2주 주기 | 1,200만+ | `player_client=android` | ✅ |
| youtube-dl | [ytdl-org/youtube-dl](https://github.com/ytdl-org/youtube-dl) | 2021-12 이후 정지 | 비교 안 될 만큼 적음 | 옵션 자체 없음 | ❌ |
| pytube | [pytube/pytube](https://github.com/pytube/pytube) | 최근 12개월 신규 버전 거의 없음 | 미확인 | 없음 | ❌ |
| pytubefix | [JuanBindez/pytubefix](https://github.com/JuanBindez/pytubefix) | 활발함 | 미확인 | PO Token(자동 생성) | ⚠️ 메타데이터만 |

원조는 youtube-dl이었지만 안정 릴리스가 2021년 12월 이후로 멈춰 사실상 관리가 끊겼다. yt-dlp는 그 youtube-dl에서 갈라져 나온 포크로, 지금은 2주마다 릴리스되고 PyPI 월 다운로드가 1,200만 건을 넘는 이 분야의 사실상 표준이다. 유튜브 공식 API(Data API v3)는 오디오·영상 다운로드 기능 자체가 없어 처음부터 비교 대상이 아니었다.

pytube는 GitHub에 2026년 들어서도 추출 실패 이슈가 해결 안 된 채 쌓여있고(#2167, #2166 등), Snyk 분석에서도 최근 12개월간 신규 버전이 거의 없어 방치된 프로젝트로 분류된다. 유저들이 pytubefix라는 커뮤니티 포크로 옮겨가는 흐름까지 있다.

pytubefix는 직접 설치해서 테스트했다. 처음엔 `use_po_token=True` 옵션으로 테스트했는데, 이건 deprecated된 경로라 `visitorData`를 사람이 직접 입력해야 했다 — 잘못된 방법으로 테스트한 결과였다. 진짜 자동 생성 방법은 `YouTube(url, 'WEB')`처럼 클라이언트를 지정하는 것이었고, 이걸로 다시 하니 사람 개입 없이 7초 만에 제목·메타데이터를 가져왔다. 다만 실제 오디오 다운로드까지 진행하면 `SABRError: Stream protection status: PoToken PENDING`으로 실패했다. 만들어진 파일도 1.1MB짜리 미완성본이었다(같은 영상을 yt-dlp로 받으면 9.99MB 완성본이 나온다). 즉 pytubefix의 자동 토큰 생성은 메타데이터 조회는 통과시키지만, 실제 스트림 다운로드 단계의 SABR 보호까지는 못 뚫는다. yt-dlp는 `player_client=android` 옵션으로 이 SABR 문제 자체를 우회하는 경로를 타서 다운로드까지 완전히 자동으로 끝낸다. pytubefix가 탈락한 이유는 활발함이 부족해서가 아니라, 메타데이터는 되고 실제 다운로드는 안 되는 상태이기 때문이다.

이 활발한 관리 덕을 실제로 본 사례도 있다. 유튜브가 2024년부터 PO Token을 요구하며 봇 차단을 강화했을 때, yt-dlp는 android 클라이언트 우회 옵션을 그 직후에 추가해 바로 대응했다. 4년 전 멈춘 youtube-dl이었다면 이 옵션 자체가 존재할 수 없었다. "유지보수가 빠른 도구가 낫다"가 아니라 "2024년에 새로 생긴 문제를 그 이후로도 계속 패치되는 도구만 풀 수 있었다"가 정확한 설명이다.
