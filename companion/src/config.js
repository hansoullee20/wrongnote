import os from "node:os";
import path from "node:path";

/* 바인드 주소는 설정 대상이 아니다. 0.0.0.0으로 열리는 순간 같은 네트워크의
   아무 기기나 큐를 비울 수 있다. 상수로 박아둔다. */
export const BIND_ADDRESS = "127.0.0.1";

export const DEFAULT_PORT = 43119;

export const QUEUE_FORMAT_VERSION = 1;

/* 리스는 브라우저 탭이 죽었을 때 항목을 되찾는 유일한 수단이다. 짧으면
   느린 저장 도중 남이 같은 항목을 집어가고, 길면 탭이 죽은 뒤 그만큼
   기다린다. 60초는 초안 초기화까지의 시간이지 저장까지의 시간이 아니다 —
   정산은 저장 시점이고, 그때까지 리스는 갱신된다. */
export const LEASE_MS = 60_000;

/* accepted 묘비 보존 기간. 중복 판정에만 쓰인다. 호스트가 같은 분석을
   재전송했을 때 이미 받아들인 것을 다시 큐에 넣지 않기 위한 최소 기억이다. */
export const TOMBSTONE_MS = 24 * 60 * 60 * 1000;

/* dead-letter는 만료되지 않는다. 사용자가 요청한 분석이 조용히 사라지지
   않는다는 약속이 이 파일 하나에 걸려 있다. 단일 사용자 로컬 파일이라
   무한 보존의 비용은 사실상 없다. */

export const MAX_ACTIVE_ITEMS = 100;
export const MAX_PAYLOAD_BYTES = 256 * 1024;

export const queueFilePath = (env = process.env) =>
  env.WRONGNOTE_QUEUE_FILE ||
  path.join(os.homedir(), ".wrongnote", "ai-queue-v1.json");

export const queuePort = (env = process.env) =>
  Number(env.WRONGNOTE_QUEUE_PORT) || DEFAULT_PORT;
