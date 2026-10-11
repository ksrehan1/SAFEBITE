/*
 * SafeBite: scanner
 * -----------------
 * Reads a menu from an image, entirely inside the browser:
 *   - jsQR finds and decodes a QR code (if the photo has one)
 *   - Tesseract.js reads the printed text (OCR)
 * Both libraries are loaded from a CDN in index.html, so the first scan needs internet.
 */
(function (root) {
  "use strict";

  // Load a File into a canvas, shrunk so that its longest side is at most maxSide pixels.
  function fileToCanvas(file, maxSide) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("The image could not be opened."));
      };
      img.src = url;
    });
  }

  // Returns the QR text, or null if no QR code is found.
  function readQR(canvas) {
    if (typeof root.jsQR !== "function") return null;
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = root.jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
    return code && code.data ? code.data : null;
  }

  // Returns the text found in the image. onProgress receives (0..1, status text).
  async function readText(canvas, onProgress) {
    if (!root.Tesseract) throw new Error("The text reader could not load. Check your internet connection.");
    const worker = await root.Tesseract.createWorker("eng", 1, {
      logger: function (m) {
        if (onProgress && typeof m.progress === "number") onProgress(m.progress, m.status);
      },
    });
    try {
      const result = await worker.recognize(canvas);
      return result.data.text || "";
    } finally {
      await worker.terminate();
    }
  }

  // The one function the UI calls. Resolves to { type: "qr" | "text", value }.
  async function scanImage(file, onProgress) {
    const small = await fileToCanvas(file, 1000);
    const qr = readQR(small);
    if (qr) return { type: "qr", value: qr };
    const big = await fileToCanvas(file, 1800);
    const text = await readText(big, onProgress);
    return { type: "text", value: text };
  }

  root.SafeBiteScanner = { scanImage: scanImage };
})(window);
