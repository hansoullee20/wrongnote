import { createWorker } from "tesseract.js";

let workerPromise = null;
let progressHandler = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(["kor", "eng"], 1, {
      logger: (m) => {
        if (progressHandler) progressHandler(m);
      },
    });
  }
  return workerPromise;
}

export async function ocrImage(file, onProgress) {
  progressHandler = onProgress;
  try {
    const worker = await getWorker();
    const {
      data: { text },
    } = await worker.recognize(file);
    return text;
  } finally {
    progressHandler = null;
  }
}
