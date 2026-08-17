# Receipt Worker Web

영수증 50개를 Worker 한 명이 모두 검토하는 연구용 웹 애플리케이션입니다. 화면은 `Instructions → Start → Randomized 50 Tasks → Completion`만 제공하며 `/admin`이나 연구자용 대시보드는 없습니다. 연구 결과는 Supabase의 테이블과 View에서 확인합니다.

## 구현 구조

```text
Browser (Worker only)
  ├─ localStorage: anonymous sessionId only
  ├─ receipt image + exact question
  └─ answer submission
          ↓
Next.js / Vercel Route Handlers
  ├─ server/answer-key.json (server only)
  ├─ answer normalization + validation
  └─ server-secret-only Supabase requests
          ↓
Supabase PostgreSQL
  ├─ transaction-safe RPC functions
  ├─ experiment_sessions
  ├─ experiment_responses
  └─ researcher Views
```

주요 디렉터리:

```text
app/                         Worker UI + Vercel API
components/receipt-task-app  Worker flow
lib/server/                  answer validation, shuffle, server DB client
public/receipts/             receipt_01.png … receipt_50.png
server/answer-key.json       public 밖의 유일한 정답 원본
supabase/migrations/         tables, functions, RLS, Views
tests/                       normalization, randomization, asset/security checks
```

## 데이터와 정답 보안

- 제공된 50개 이미지와 `answer_key.json`의 50개 행을 1:1로 검증했습니다.
- JSON의 `질문`을 변경하거나 새로 생성하지 않습니다.
- `server/answer-key.json`은 Server Route에서만 import합니다. `public`, Client Component, HTML, localStorage에 들어가지 않습니다.
- `/api/task/current`는 현재 이미지 URL, 질문, 진행률만 반환합니다.
- `/api/task/submit`은 `{ "saved": true, "hasMore": boolean }`만 반환합니다. 정답, `isCorrect`, 정확도는 반환하지 않습니다.
- Supabase URL과 server secret key는 `NEXT_PUBLIC_` 환경 변수를 쓰지 않습니다. Browser가 Supabase에 직접 접속하지 않습니다.
- 정답 저장소를 포함하므로 소스 저장소는 private으로 운영하는 것을 권장합니다. 배포된 정적 자산에는 정답 파일이 포함되지 않습니다.

## 세션과 랜덤 순서

첫 방문 시 Browser의 `crypto.randomUUID()`로 익명 ID를 만들고 `/api/session/open`에서 `opened` 행을 만듭니다. 이때는 연구 참여 시작으로 계산하지 않습니다.

`작업 시작` 클릭 시에만 `/api/session/start`가:

1. Node `crypto.randomInt()`를 사용하는 Fisher–Yates shuffle로 50개 ID를 섞습니다.
2. DB 함수가 50개가 모두 존재하고 중복이 없는지 재검증합니다.
3. `receipt_order`, `started_at`, `status = started`를 한 번만 저장합니다.

이미 시작된 세션은 다시 shuffle하지 않습니다. 새로고침 후에도 DB의 `receipt_order`, `current_index`, 응답을 사용해 같은 순서로 복원합니다.

## 서버 계산과 제출 무결성

- 현재 Receipt ID는 Browser가 아니라 저장된 `receipt_order[current_index]`로 재검증합니다.
- `shown_at`은 `/api/task/current`가 DB에 최초 1회 기록합니다.
- `started_at`부터 20분을 운영상 기준 시간으로 사용하며, 새로고침 후에도 서버 시간을 기준으로 타이머를 복원합니다.
- 20분을 넘겨도 응답 제출과 나머지 Task 진행은 막지 않습니다. 완료 시간이 20분을 초과한 Worker는 정확도와 관계없이 `INATTENTIVE`(잠재적 불성실)로 분류합니다.
- `elapsed_time_ms`는 시작 시 0으로 생성되고 Task 조회, 문항 제출, 30초 heartbeat, 페이지 이탈, 완료 시점마다 DB에서 갱신됩니다. 따라서 모든 시작 세션의 관측된 작업 시간을 Supabase에서 확인할 수 있습니다.
- `submitted_at`과 `response_time_ms`는 제출 RPC 내부의 DB 시간으로 계산합니다.
- 응답 INSERT와 session aggregate 갱신은 하나의 행 잠금 트랜잭션에서 실행됩니다.
- `(session_id, receipt_id)`와 `(session_id, presentation_index)` 모두 unique입니다.
- 완료 RPC는 응답 테이블을 다시 집계하고 정확히 50개일 때만 완료합니다.
- `worker_answer`, correctness, partial response time을 포함한 raw data는 분류와 관계없이 삭제하지 않습니다.

### Answer normalization

메뉴 답변은 Unicode NFKC, 앞뒤 공백 제거, 중복 공백 축소를 적용합니다. 가격 정답은 다음을 동일하게 판정합니다.

```text
4,000 = 4000 = 4000원 = ₩4,000
```

`약 4,000원`, `4천원` 같은 fuzzy/추정 표현은 자동 동치 처리하지 않습니다.

## Supabase 설치

1. Supabase 프로젝트를 생성합니다.
2. 새 프로젝트라면 SQL Editor에서 [`supabase/migrations/001_receipt_experiment.sql`](supabase/migrations/001_receipt_experiment.sql)을 전체 실행합니다.
3. 기존에 `001` 또는 `001` + `002`를 이미 실행한 배포 프로젝트라면 [`supabase/migrations/003_overtime_classification_and_elapsed_time.sql`](supabase/migrations/003_overtime_classification_and_elapsed_time.sql)을 전체 실행합니다. 이 migration이 기존의 20분 강제 종료 규칙을 진행 허용 규칙으로 교체하고 시간 컬럼과 View를 갱신합니다.
4. Project Settings → API Keys에서 Project URL과 `sb_secret_...` 형식의 server-side Secret key를 확인합니다.
5. 로컬 `.env.local` 또는 Vercel Environment Variables에 아래 값을 설정합니다.

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_YOUR_SERVER_ONLY_KEY
GOOGLE_FORM_URL=https://forms.gle/YOUR_GOOGLE_FORM_ID
```

새 Secret key를 권장합니다. 기존 Legacy `service_role` JWT를 유지해야 하는 배포는 `SUPABASE_SERVICE_ROLE_KEY` 환경 변수도 계속 지원합니다. `NEXT_PUBLIC_SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`, publishable key는 이 서버 권한 자리에 사용하지 마세요.

`GOOGLE_FORM_URL`에는 `https://forms.gle/...` 또는 `https://docs.google.com/forms/...` 주소를 입력합니다. 설정된 경우에만 완료 페이지에 `설문 작성하기` 버튼이 표시됩니다. Vercel 환경변수를 추가하거나 수정한 뒤에는 반드시 새 Deployment를 실행합니다.

### Table 구조

`experiment_sessions`

- 상태: `status`, `participant_status`
- 시간: `opened_at`, `started_at`, `completed_at`, `last_seen_at`, `elapsed_time_ms`, `completion_time_ms`, `time_limit_exceeded`
- 집계: `total_tasks`, `attempted_tasks`, `correct_tasks`, `incorrect_tasks`
- 정확도: `task_accuracy`, `partial_accuracy`
- 진행: `current_index`, `current_shown_at`, `receipt_order`

`experiment_responses`

- 식별/순서: `session_id`, `receipt_id`, `presentation_index`, `assigned_type`
- raw/판정: `worker_answer`, `is_correct`
- 시간: `shown_at`, `submitted_at`, `response_time_ms`

`experiment_config`

- `inattentive_accuracy_threshold = 0.70` 한 곳에서 정확도 threshold를 관리합니다.
- `task_time_limit_minutes = 20` 한 곳에서 시간 기준을 관리합니다.

정확도 threshold 변경 예:

```sql
update public.experiment_config
set numeric_value = 0.80
where config_key = 'inattentive_accuracy_threshold';
```

변경은 이후 완료되는 세션의 분류부터 적용됩니다. 과거 raw data는 유지됩니다.

RLS는 세 테이블 모두 활성화되어 있고 anon/authenticated policy는 없습니다. 관련 RPC도 `service_role`에만 실행 권한이 있습니다.

## 연구자가 Supabase에서 확인할 위치

Supabase → Table Editor 또는 SQL Editor에서 다음 View를 사용합니다.

| View | 내용 |
|---|---|
| `worker_results` | 모든 Worker의 분류, 정확도, 시간, 진행률, randomized order |
| `normal_workers` | `participant_status = NORMAL`인 완료 Worker |
| `inattentive_workers` | 정확도 threshold 미만 또는 20분을 초과한 완료 Worker(잠재적 부주의, 연구용 operational classification) |
| `dropout_workers` | 시작했지만 아직 완료하지 않은 Worker와 partial accuracy |
| `experiment_metrics` | Task Accuracy, Completion Time, Dropout Rate와 집단별 요약 |

예:

```sql
select * from public.worker_results order by opened_at desc;
select * from public.normal_workers;
select * from public.inattentive_workers;
select * from public.dropout_workers order by last_seen_at desc;
select * from public.experiment_metrics;
select * from public.experiment_responses order by session_id, presentation_index;
```

`DROPOUT`은 `started_at IS NOT NULL AND completed_at IS NULL`이라는 운영 정의이므로, 현재 작업 중인 세션도 완료 전까지 이 View에 보입니다. 실제 이탈 판단 시 `last_seen_at`과 연구 종료 시점을 함께 검토하세요. 단순 방문 후 시작하지 않은 `opened` 세션은 분류와 Dropout Rate에서 제외됩니다.

## 분류와 지표 공식

공통 DB 함수 `classify_participant()`의 우선순위:

```text
started_at IS NULL                         → NULL
started_at IS NOT NULL, completed_at NULL  → DROPOUT
completed, completion_time_ms > 20분       → INATTENTIVE
completed, accuracy < config threshold     → INATTENTIVE
completed, accuracy >= config threshold    → NORMAL
```

`INATTENTIVE`는 낮은 정확도 또는 20분 초과를 바탕으로 한 “potentially inattentive” 연구용 분류일 뿐 실제 부주의를 단정하지 않습니다. 20분을 넘겼더라도 Worker 화면과 서버는 50개 문항 완료를 계속 허용합니다.

- Completed worker Task Accuracy = `correct_tasks / 50`
- Dropout partial accuracy = `correct_tasks / attempted_tasks`
- Completion Time = `completed_at - started_at` (DB raw millisecond 저장)
- Started Worker elapsed time = 시작 직후부터 마지막 서버 접점까지의 `elapsed_time_ms` (완료 Worker는 `completion_time_ms`와 동일)
- Receipt response time = `submitted_at - shown_at` (DB raw millisecond 저장)
- Dropout Rate = `(started_sessions - completed_sessions) / started_sessions`

`experiment_metrics`는 분석 대상을 나중에 선택할 수 있도록 아래를 구분합니다.

- `mean_accuracy_completed`, `median_task_accuracy`: 모든 완료 Worker
- `mean_accuracy_normal`: Normal Worker
- `mean_accuracy_inattentive`: Inattentive Worker
- `mean_completion_time_ms`, `median_completion_time_ms`: 모든 완료 Worker
- `mean_elapsed_time_ms_started`: 시작한 모든 Worker의 관측 작업 시간
- `workers_over_time_limit`: 20분 기준을 초과한 Worker 수

## Vercel 배포

1. 이 디렉터리를 private Git 저장소에 push합니다.
2. Vercel에서 Import Project 후 Framework Preset을 Next.js로 둡니다.
3. 위의 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GOOGLE_FORM_URL`을 Production/Preview 환경에 등록합니다. 기존 Legacy 설정은 `SUPABASE_SERVICE_ROLE_KEY` 이름 그대로도 동작합니다.
4. Deploy합니다. `vercel.json`은 서울(`icn1`) Server Function region을 지정합니다.
5. 배포 후 Browser DevTools에서 다음을 확인합니다.
   - Network의 current/submit/complete 응답에 정답·correctness·accuracy가 없음
   - Sources/static chunks에 answer key가 없음
   - Application → Local Storage에는 익명 session ID만 있음

## 로컬 실행과 테스트

Node 20 이상이 필요합니다.

```bash
npm install
cp .env.example .env.local
npm test
npm run verify:assets
npm run build
npm run dev
```

실제 API end-to-end 테스트에는 migration이 적용된 Supabase 테스트 프로젝트의 환경 변수가 필요합니다. 단위 테스트는 가격/메뉴 정규화, 과도한 fuzzy 거부, Fisher–Yates 보존성, 50개 asset 매칭, Client/API 정답 비노출을 검사합니다.

Migration 적용 뒤 Supabase SQL Editor에서 [`supabase/tests/classification_scenarios.sql`](supabase/tests/classification_scenarios.sql)을 실행하면 45/50 Normal, 22/50 저정확도 Inattentive, 50/50 고정확도이지만 21분 초과 Inattentive, 11/18 Dropout, 시작하지 않은 방문자 시나리오를 검증합니다. 전체가 transaction 안에서 실행되고 마지막에 rollback됩니다.
