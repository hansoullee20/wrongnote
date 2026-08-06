// 문제 사진 저장소 — IndexedDB blob 저장. 노트는 images:[id] 참조만 가진다.
import { uid } from "./constants.js";

const DB_NAME = "wrongnote";
const DB_VERSION = 1;
const STORE = "images";

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** blob 저장 → id 반환 */
export async function putImage(blob, id = uid()) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readwrite").put(blob, id);
    req.onsuccess = () => resolve(id);
    req.onerror = () => reject(req.error);
  });
}

/** id → Blob (없으면 undefined) */
export async function getImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteImages(ids) {
  if (!ids?.length) return;
  const db = await openDB();
  const store = tx(db, "readwrite");
  for (const id of ids) store.delete(id);
}

export async function getAllImageIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly").getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 노트에서 참조하지 않는 고아 blob 정리 (가져오기 후 호출) */
export async function gcImages(referencedIds) {
  const keep = new Set(referencedIds);
  const all = await getAllImageIds();
  await deleteImages(all.filter((id) => !keep.has(id)));
}

/**
 * 저장 전 압축: 최대 변 maxDim, JPEG. 태블릿 원본(수 MB)을 ~200KB로.
 * 실패하면 원본 그대로 반환 (저장은 계속돼야 한다).
 */
export async function compressImage(file, maxDim = 1600, quality = 0.82) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    return blob || file;
  } catch {
    return file;
  }
}

// ---- 백업용 직렬화 (JSON 내보내기에 사진 포함) ----

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

/** ids → {id: dataUrl} — 내보내기용 */
export async function exportImages(ids) {
  const out = {};
  for (const id of ids) {
    const blob = await getImage(id);
    if (blob) out[id] = await blobToDataUrl(blob);
  }
  return out;
}

/**
 * {id: dataUrl} → IDB 복원 — 가져오기용.
 *
 * 실패를 삼키지 않는다. 예전엔 개별 실패를 catch로 먹고 호출부가 그대로
 * 교체를 진행해서, **사진 id는 있는데 blob은 없는 "성공한" 가져오기**가 됐다.
 * 이 앱은 사진 id를 가진 노트를 만들면 blob도 반드시 있어야 한다 —
 * "추측해서 데이터를 만들지 않는다"와 같은 방향이다.
 *
 * 이미 복원된 앞선 blob은 여기서 지우지 않는다. 가져오기가 중단되므로
 * 노트 교체도 GC도 실행되지 않고, 같은 백업을 재시도하면 같은 id로 put하므로
 * 중복이 생기지 않는다. 남는 고아는 후속 D-gc의 회수 대상이다.
 *
 * @returns {Promise<boolean>} 전부 복원됐으면 true
 */
export async function importImages(map) {
  if (!map) return true;
  for (const [id, dataUrl] of Object.entries(map)) {
    try {
      await putImage(await dataUrlToBlob(dataUrl), id);
    } catch {
      return false; // 즉시 중단 — 호출부가 교체를 취소한다
    }
  }
  return true;
}
