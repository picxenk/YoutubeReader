- 첫 PROJECT.md 스펙문서는 ChatGPT 무료버전에서 생성되었습니다. (2026-09-02)
  - https://chatgpt.com/share/6a981680-9b78-83ee-a3d0-eef074cd6986
- Coded by picxenk with GLM-5.2(OpenCode Zen, ~$10)

# YoutubeReader

yt-dlp 기반 유튜브 영상·음성 다운로드 로컬 웹앱. URL을 입력하면 받을 수 있는 화질과 용량을 확인하고 선택해서 다운로드할 수 있다. 각 영상은 개별 폴더로 관리되며 영상(mp4)과 음성(mp3), 그리고 원본 URL 등의 정보를 담은 `INFO.md`가 함께 저장된다. 상단 탭에서 다운로더와 뷰어(읽기)를 오갈 수 있다.

## 요구 사항

- Node.js 18.11 이상
- yt-dlp (시스템에 설치)
- ffmpeg (시스템에 설치 — 오디오 추출 및 영상 병합에 필요)

macOS 설치:

```bash
brew install yt-dlp ffmpeg
```

## 설치 및 실행

더블클릭 실행 (macOS):

데스크톱의 `YoutubeReader` 아이콘을 더블클릭하면 터미널 창이 열리며 서버가 시작되고 브라우저가 자동으로 열린다. 실체는 프로젝트 폴더의 `YoutubeReader.command`이고 데스크톱에는 심볼릭 링크로 연결되어 있다. 이미 실행 중이면 브라우저만 열고, 최초 실행 시 의존성을 자동 설치한다. 중지는 터미널 창에서 `Ctrl+C` 또는 창 닫기.

터미널에서 실행:

```bash
npm install
npm run dev
```

일반 실행:

```bash
npm start
```

브라우저에서 http://localhost:3000 접속.

## 사용 방법

### 다운로더 탭

1. URL 입력 후 `확인` 클릭 — 영상 제목·썸네일·길이와 함께 받을 수 있는 화질 목록(해상도·예상 용량)이 표시된다.
2. 화질을 선택하거나 `음성만(MP3)`을 선택한다. 영상을 고르면 MP4와 별도의 MP3가 항상 함께 저장된다.
3. `다운로드` 클릭 — 진행률·속도·ETA가 실시간으로 표시된다.
4. Downloads 목록에서 `읽기`(뷰어 탭에서 열기) 또는 `삭제`(폴더 전체 삭제)를 쓸 수 있다.

### 뷰어 탭

`읽기`를 누른 항목을 표시한다. 영상·오디오 재생과 `INFO.md` 내용(원본 URL, 채널, 길이, 업로드일, 화질, 파일 목록)을 함께 보여준다. 스크립트를 스크롤해도 영상은 화면 상단에 고정된다.

### 스크립트 추출 (Whisper)

뷰어의 정보 아래 `스크립트 추출` 버튼을 누르면 항목의 음성 파일을 로컬 Whisper로 변환해 타임라인이 포함된 스크립트를 만든다. 결과는 폴더에 `script.json`(앱용)과 `SCRIPT.md`(사람이 읽는 용)로 저장된다. 스크립트의 각 문장 옆 재생 버튼을 누르면 해당 위치에서 영상이 재생되고, 재생 중인 문장이 하이라이트된다. 원본이 유튜브 영상이면 시간 표기가 링크가 되어 클릭 시 해당 시간부터 재생되는 유튜브 페이지가 새 탭에 열린다(링크를 우클릭해 URL을 복사할 수도 있다). 영상 타임라인을 클릭하면 해당 시간의 문장으로 스크립트가 이동하고, 영상 하단의 `Sync` 체크박스를 켜면 재생 중 스크립트가 자동으로 따라간다.

스크립트에서 드래그하면 문장 단위로 선택되며, 복사하면 마지막에 `[시작시간 : 끝시간 - 영상제목]` 인용 줄이 자동으로 함께 들어간다.

문장을 클릭하거나 드래그해 선택하면 하이라이트/메모 메뉴가 자동으로 뜬다. 하이라이트는 문장에 형광펜 배경을 칠하고, 메모는 문장 아래 메모 상자로 남는다. 모든 주석은 폴더에 `notes.json`(데이터)과 `NOTES.md`(마크다운)로 저장되며, 재추출 버튼 옆의 `하이라이트·메모` 버튼으로 마크다운 형식으로 한 번에 볼 수 있다. 이 전체보기에서도 원본이 유튜브 영상이면 각 주석의 시간이 링크가 되어 클릭 시 해당 시간부터 재생되는 유튜브 페이지가 새 탭에 열린다.

Whisper 엔진은 프로젝트 로컬 venv에 설치한다 (Apple Silicon 기준, mlx-whisper):

```bash
python3 -m venv .venv-whisper
.venv-whisper/bin/pip install mlx-whisper
```

- 기본 모델: `mlx-community/whisper-small-mlx` (첫 실행 시 자동 다운로드)
- 모델 변경: `WHISPER_MODEL` 환경변수 (예: `mlx-community/whisper-large-v3-turbo`)
- PATH의 `mlx_whisper`, `whisper`(openai-whisper)가 있으면 그것을 먼저 사용한다

## 저장 구조

각 영상은 `downloads/` 안에 제목 이름의 개별 폴더로 저장된다.

```text
downloads/
└── <영상 제목>/
    ├── video.mp4   # 선택한 화질의 영상
    ├── audio.mp3   # 별도로 추출한 음성
    └── INFO.md     # 원본 URL 및 메타데이터
```

- 영상 다운로드 시 음성(mp3)이 항상 함께 저장된다.
- `INFO.md`에는 원본 URL, 채널, 길이, 업로드일, 화질, 다운로드일, 파일 목록이 기록된다.
- 이전 버전처럼 `downloads/`에 바로 저장된 파일은 서버 시작 시 폴더 구조로 자동 마이그레이션된다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/inspect` | 영상 정보 확인 — `{ url }` → 제목·썸네일·길이·화질 옵션(용량 포함) |
| POST | `/api/download` | 다운로드 시작 — `{ url, type: "video" \| "audio", quality?: "best" \| "<height>" }` |
| GET | `/api/downloads` | 다운로드된 항목(폴더) 목록 |
| GET | `/api/item/:folder` | 항목 상세 — 파일 목록 + INFO.md + 스크립트(script.json) + 원본 URL(sourceUrl) |
| POST | `/api/transcribe` | 스크립트 변환 시작 — `{ folder }` (Whisper 로컬 변환) |
| GET | `/api/transcribe/:id` | 변환 작업 상태 |
| POST | `/api/annotations` | 하이라이트/메모 추가 — `{ folder, type, start, end, text, note? }` → `notes.json`·`NOTES.md` 저장 |
| DELETE | `/api/annotations` | 주석 삭제 — `{ folder, id }` |
| GET | `/api/download/:id` | 다운로드 작업 상태 (`waiting` / `downloading` / `completed` / `failed`, 단계·진행률·속도·ETA 포함) |
| DELETE | `/api/downloads/:folder` | 항목(폴더 전체) 삭제 |
| GET | `/media/:folder/:filename` | 브라우저 재생용 파일 제공 (Range 요청 지원) |

다운로드는 한 번에 하나씩 실행되며, 추가 요청은 대기열에 쌓인다.

## 프로젝트 구조

```text
├── PROJECT.md
├── package.json
├── README.md
├── YoutubeReader.command   # 데스크톱 더블클릭 실행 스크립트
├── src/
│   ├── server.js      # Express 서버 및 API 라우트
│   ├── inspector.js   # yt-dlp -J 메타데이터 조회 및 화질 옵션 생성
│   ├── downloader.js  # yt-dlp subprocess 실행(영상+음성 2단계), INFO.md 생성
│   └── files.js       # downloads/ 폴더 항목 목록·조회·삭제·마이그레이션
├── public/
│   ├── index.html     # 탭(다운로더/뷰어) 레이아웃
│   ├── app.js         # 확인 → 화질 선택 → 다운로드, 탭/뷰어, INFO.md 렌더링
│   └── style.css
└── downloads/         # 영상별 개별 폴더 (자동 생성)
```

## 보안

- URL은 shell 문자열에 연결하지 않고 `spawn()` 인자로만 전달
- 항목·미디어 요청은 `downloads/` 내부 경로로 한정 (path traversal 차단)
- localhost 개인용이므로 인증/DB 없음 — 자세한 내용은 PROJECT.md 참고
