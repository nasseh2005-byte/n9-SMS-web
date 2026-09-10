import { createXmlMessageParser } from "./xmlImport.js";

self.onmessage = async ({ data: file }) => {
  try {
    const parser = createXmlMessageParser();
    const reader = file.stream().getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.write(decoder.decode(value, { stream: true }));
      }
      parser.write(decoder.decode());
    } finally {
      reader.releaseLock();
    }
    self.postMessage({ messages: parser.finish() });
  } catch (error) {
    self.postMessage({ error: error.message || "تعذر استيراد ملف XML." });
  }
};
