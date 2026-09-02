# PROJECT.md

# Local Video Downloader

URL을 입력하면 `yt-dlp`를 이용해 온라인 영상 또는 음성을 로컬 폴더에 다운로드하고, 웹 브라우저에서 다운로드 목록을 확인할 수 있는 개인용 로컬 웹앱.

## 1. 목표

개인이 자신의 컴퓨터에서 실행하는 간단한 로컬 다운로드 서비스다.

사용자는 웹 UI에서 영상 URL을 입력하고 다운로드 형식을 선택한다.

- Video: 영상 + 음성
- Audio: 음성만

다운로드가 완료되면 지정된 로컬 폴더에 파일이 저장되고, 웹 UI에서 다운로드된 파일 목록을 확인할 수 있다.

복잡한 사용자 계정, 데이터베이스, 클라우드 저장소, 외부 API는 사용하지 않는다.

---

## 2. 핵심 사용자 흐름

```text
웹 브라우저
    │
    ├─ URL 입력
    ├─ Video / Audio 선택
    └─ Download
          │
          ▼
       서버
          │
          ▼
       yt-dlp
          │
          ▼
    ./downloads/
          │
          ▼
      파일 목록
          │
          ├─ 재생 / 열기
          └─ 삭제
```

---

## 3. MVP 기능

### 3.1 URL 입력

메인 화면에 URL 입력창을 제공한다.

예:

```text
https://www.youtube.com/watch?v=...
```

Download 버튼을 누르면 다운로드를 시작한다.

지원 사이트는 `yt-dlp`가 지원하는 범위에 따른다. 앱에서 사이트별 로직을 별도로 구현하지 않는다.

---

### 3.2 다운로드 형식

두 가지 옵션만 제공한다.

#### Video

가능한 적절한 최고 품질의 영상과 음성을 다운로드한다.

최종 파일은 하나의 일반적인 영상 파일이어야 한다.

예:

```text
video title.mp4
```

#### Audio

영상에서 음성만 추출한다.

기본 포맷:

```text
audio title.mp3
```

내부적으로 `yt-dlp`의 audio extraction 기능을 사용한다.

---

### 3.3 다운로드 폴더

모든 결과물은 프로젝트 내부의 다음 폴더에 저장한다.

```text
./downloads/
```

앱 시작 시 폴더가 없으면 자동으로 생성한다.

파일명에는 `yt-dlp`의 title metadata를 사용하되 파일 시스템에서 문제가 되는 문자는 안전하게 처리한다.

---

### 3.4 다운로드 상태

다운로드 중에는 UI에 상태를 표시한다.

최소한 다음 상태를 구분한다.

```text
대기
다운로드 중
완료
실패
```

가능하다면 다운로드 진행률도 표시한다.

예:

```text
Downloading...

████████████░░░░░░░░ 62%
```

MVP에서는 WebSocket을 사용하지 않고 polling으로 구현해도 된다.

---

### 3.5 다운로드 목록

메인 화면에서 `downloads/` 폴더의 파일 목록을 보여준다.

각 항목에는 최소한 다음 정보를 표시한다.

- 파일명
- 파일 형식
- 파일 크기
- 다운로드 날짜
- 재생/열기
- 삭제

예:

```text
Downloads

──────────────────────────────────────

Video Title
MP4 · 124 MB
[Play] [Delete]

Another Video
MP3 · 18 MB
[Play] [Delete]
```

최신 파일이 위에 표시되도록 한다.

---

### 3.6 로컬 재생

브라우저에서 가능한 파일은 바로 재생할 수 있어야 한다.

Video:

```text
<video controls>
```

Audio:

```text
<audio controls>
```

별도의 미디어 플레이어를 만들지 않는다.

---

### 3.7 삭제

목록에서 파일을 삭제할 수 있다.

삭제 전 간단한 확인을 한다.

삭제하면 실제 `downloads/` 폴더의 파일도 삭제한다.

---

## 4. 기술 방향

MVP는 다음과 같이 구현한다.

### Backend

Node.js

간단한 HTTP 서버 프레임워크를 사용한다.

예:

```text
Node.js
Express
```

### Frontend

가능하면 별도의 복잡한 프론트엔드 프레임워크를 사용하지 않는다.

기본:

```text
HTML
CSS
JavaScript
```

필요하다면 단순한 frontend framework를 사용할 수 있지만 React/Next.js 등의 도입은 MVP에서 피한다.

### Downloader

반드시 시스템에 설치된 `yt-dlp` executable을 subprocess로 호출한다.

Node.js에서:

```text
child_process.spawn()
```

또는 동등한 비동기 subprocess 방식을 사용한다.

`yt-dlp`의 동작을 Node.js에서 직접 재구현하지 않는다.

---

## 5. 예상 프로젝트 구조

```text
local-video-downloader/
│
├── PROJECT.md
├── package.json
├── README.md
│
├── src/
│   ├── server.js
│   ├── downloader.js
│   └── files.js
│
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
│
└── downloads/
```

구조는 구현 과정에서 합리적으로 변경할 수 있다.

핵심은 frontend와 backend의 역할을 지나치게 복잡하게 분리하지 않는 것이다.

---

## 6. API

최소한 다음 API를 제공한다.

### POST `/api/download`

다운로드를 시작한다.

Request:

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "type": "video"
}
```

또는:

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "type": "audio"
}
```

Response:

```json
{
  "id": "download-job-id",
  "status": "started"
}
```

---

### GET `/api/downloads`

현재 다운로드된 파일 목록을 반환한다.

```json
[
  {
    "name": "example.mp4",
    "size": 123456789,
    "modified": "2026-09-02T12:00:00Z",
    "type": "video"
  }
]
```

파일 시스템을 기준으로 목록을 생성한다.

데이터베이스에 파일 목록을 저장하지 않는다.

---

### GET `/api/download/:id`

다운로드 작업의 현재 상태를 반환한다.

```json
{
  "id": "download-job-id",
  "status": "downloading",
  "progress": 62
}
```

---

### DELETE `/api/downloads/:filename`

해당 파일을 삭제한다.

파일 경로를 그대로 신뢰하지 말고 반드시 `downloads/` 디렉터리 내부의 파일만 삭제할 수 있도록 검증한다.

---

### GET `/media/:filename`

`downloads/` 내부 파일을 브라우저에서 재생하거나 열 수 있도록 제공한다.

경로 traversal 공격을 방지한다.

---

## 7. yt-dlp 호출

### Video

기본적으로 yt-dlp가 적절한 영상+음성 포맷을 선택하도록 한다.

개념적으로:

```bash
yt-dlp \
  -f "bv*+ba/b" \
  --merge-output-format mp4 \
  -o "./downloads/%(title)s.%(ext)s" \
  "<URL>"
```

실제 구현에서는 현재 설치된 `yt-dlp` 버전에 맞는 안정적인 옵션을 사용한다.

### Audio

```bash
yt-dlp \
  -x \
  --audio-format mp3 \
  -o "./downloads/%(title)s.%(ext)s" \
  "<URL>"
```

Audio extraction을 위해 필요한 외부 프로그램(예: ffmpeg)이 설치되어 있지 않은 경우 명확한 오류 메시지를 사용자에게 표시한다.

---

## 8. 보안 및 입력 검증

이 앱은 localhost에서 개인적으로 사용하는 것을 전제로 한다.

그러나 기본적인 안전장치는 구현한다.

### URL

사용자가 입력한 URL을 shell command 문자열에 직접 연결하지 않는다.

반드시 subprocess argument로 전달한다.

나쁜 예:

```javascript
exec(`yt-dlp ${url}`)
```

좋은 방향:

```javascript
spawn("yt-dlp", [options..., url])
```

### 파일명

사용자가 제공한 filename을 경로로 직접 사용하지 않는다.

`downloads/` 밖으로 접근할 수 없도록 검증한다.

예:

```text
../
../../
```

등의 path traversal을 차단한다.

---

## 9. 다운로드 동시성

MVP에서는 동시에 하나의 다운로드만 실행한다.

이미 다운로드 중인 경우 새 요청은 대기시키거나 간단한 오류를 반환한다.

복잡한 job queue 시스템은 만들지 않는다.

향후 필요하면 여러 다운로드를 지원한다.

---

## 10. 오류 처리

다음과 같은 오류를 사용자에게 이해하기 쉬운 형태로 표시한다.

- 잘못된 URL
- 지원하지 않는 사이트
- yt-dlp 실행 파일을 찾을 수 없음
- ffmpeg 없음
- 다운로드 실패
- 네트워크 오류
- 파일 저장 실패
- 이미 존재하는 파일

yt-dlp의 raw stderr를 그대로 UI에 노출하기보다는 가능한 경우 간단한 오류 메시지로 변환한다.

개발 모드에서는 상세 로그를 터미널에 출력한다.

---

## 11. UI 원칙

UI는 기능 중심으로 매우 단순하게 만든다.

첫 화면에는 다음 정도만 존재한다.

```text
Local Downloader

[ URL                                      ]

(●) Video    ( ) Audio

[ Download ]

────────────────────────────────

Downloads

[파일 목록]
```

화려한 디자인이나 대시보드는 필요 없다.

데스크톱 브라우저 사용을 우선한다.

반응형 디자인은 간단하게만 지원한다.

---

## 12. 실행

개발 환경:

```bash
npm install
npm run dev
```

또는 프로젝트에서 선택한 적절한 명령을 사용한다.

서버는 기본적으로:

```text
http://localhost:3000
```

에서 실행한다.

---

## 13. 외부 의존성

필수:

```text
Node.js
yt-dlp
ffmpeg
```

`yt-dlp`와 `ffmpeg`는 Node.js dependency로 설치하지 않는다.

시스템에 설치되어 있는 executable을 사용한다.

서버 시작 시 다음을 검사한다.

```text
yt-dlp --version
ffmpeg -version
```

없는 경우 설치 방법을 알려주는 오류 메시지를 표시한다.

---

## 14. 하지 않을 것

MVP에서는 다음 기능을 구현하지 않는다.

- 사용자 로그인
- 사용자별 다운로드 폴더
- 데이터베이스
- 클라우드 저장
- Docker
- OAuth
- 다운로드 기록 DB
- playlist 관리
- 자동 자막 다운로드
- 영상 metadata 편집
- 썸네일 관리
- 여러 사용자의 동시 접속을 위한 서버 설계
- 모바일 앱
- 복잡한 frontend framework
- 자체 다운로드 엔진

---

## 15. 완료 조건

다음 시나리오가 정상적으로 동작하면 MVP 완료로 본다.

### Scenario 1 — Video

1. 브라우저에서 localhost에 접속한다.
2. YouTube 영상 URL을 입력한다.
3. Video를 선택한다.
4. Download를 누른다.
5. 서버가 `yt-dlp`를 실행한다.
6. 영상이 `downloads/`에 저장된다.
7. 다운로드 목록에 나타난다.
8. Play를 누르면 브라우저에서 재생된다.

### Scenario 2 — Audio

1. URL을 입력한다.
2. Audio를 선택한다.
3. Download를 누른다.
4. `yt-dlp`를 통해 MP3가 생성된다.
5. 목록에 나타난다.
6. 브라우저에서 재생된다.

### Scenario 3 — Delete

1. 다운로드 목록에서 Delete를 누른다.
2. 확인한다.
3. 파일이 `downloads/`에서 삭제된다.
4. UI 목록에서도 사라진다.

### Scenario 4 — Error

1. 잘못된 URL을 입력한다.
2. 다운로드가 실패한다.
3. 앱이 죽거나 서버가 종료되지 않는다.
4. 사용자에게 실패 원인을 알려준다.

---

## 16. 개발 우선순위

구현은 다음 순서로 진행한다.

```text
1. Node.js 서버
      ↓
2. yt-dlp subprocess 호출
      ↓
3. downloads 폴더 저장
      ↓
4. 파일 목록 API
      ↓
5. 최소 HTML UI
      ↓
6. 다운로드 진행 상태
      ↓
7. 브라우저 재생
      ↓
8. 삭제
      ↓
9. 오류 처리 및 polish
```

각 단계에서 실제로 동작하는 작은 결과물을 유지한다.

처음부터 모든 기능을 한 번에 구현하지 않는다.

---

## 17. 개발 원칙

이 프로젝트의 핵심은 **작고 로컬에서 확실하게 동작하는 것**이다.

가능하면 가장 적은 코드와 dependency로 구현한다.

특히 다음 원칙을 지킨다.

- 파일 시스템을 source of truth로 사용한다.
- DB를 추가하지 않는다.
- yt-dlp를 직접 호출한다.
- frontend를 과도하게 복잡하게 만들지 않는다.
- 기능을 추상화하기 전에 실제 동작을 먼저 만든다.
- MVP에 필요하지 않은 기능은 구현하지 않는다.
- 실행 방법은 README에 명확하게 기록한다.

향후 기능 확장은 실제 사용하면서 결정한다.