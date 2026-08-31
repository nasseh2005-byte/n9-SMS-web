const encoder = new TextEncoder();

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function createRecord(size, writer) {
  const bytes = new Uint8Array(size);
  writer(new DataView(bytes.buffer));
  return bytes;
}

function getDosTimestamp(date) {
  const safeDate = date instanceof Date ? date : new Date();
  const year = Math.max(1980, safeDate.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate(),
    time: (safeDate.getHours() << 11) | (safeDate.getMinutes() << 5) | Math.floor(safeDate.getSeconds() / 2),
  };
}

export class StoredZipBuilder {
  constructor(timestamp = new Date()) {
    this.parts = [];
    this.entries = [];
    this.offset = 0;
    this.timestamp = getDosTimestamp(timestamp);
    this.finished = false;
  }

  addFile(path, input) {
    if (this.finished) throw new Error("تم إغلاق ملف ZIP بالفعل.");
    const name = encoder.encode(String(path || "file"));
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    const checksum = crc32(data);
    const localOffset = this.offset;
    const { date, time } = this.timestamp;
    const localHeader = createRecord(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, time, true);
      view.setUint16(12, date, true);
      view.setUint32(14, checksum, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true);
      view.setUint16(28, 0, true);
    });
    this.parts.push(localHeader, name, data);
    this.offset += localHeader.length + name.length + data.length;
    this.entries.push({ checksum, dataLength: data.length, localOffset, name });
  }

  toBlob() {
    if (this.finished) throw new Error("تم إنشاء ملف ZIP بالفعل.");
    if (this.entries.length > 65_535) throw new Error("عدد الملفات أكبر من الحد المدعوم داخل ZIP واحد.");
    this.finished = true;
    const centralOffset = this.offset;
    const { date, time } = this.timestamp;

    for (const entry of this.entries) {
      const centralHeader = createRecord(46, (view) => {
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 20, true);
        view.setUint16(8, 0x0800, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, time, true);
        view.setUint16(14, date, true);
        view.setUint32(16, entry.checksum, true);
        view.setUint32(20, entry.dataLength, true);
        view.setUint32(24, entry.dataLength, true);
        view.setUint16(28, entry.name.length, true);
        view.setUint16(30, 0, true);
        view.setUint16(32, 0, true);
        view.setUint16(34, 0, true);
        view.setUint16(36, 0, true);
        view.setUint32(38, 0, true);
        view.setUint32(42, entry.localOffset, true);
      });
      this.parts.push(centralHeader, entry.name);
      this.offset += centralHeader.length + entry.name.length;
    }

    const centralSize = this.offset - centralOffset;
    const endRecord = createRecord(22, (view) => {
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(4, 0, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, this.entries.length, true);
      view.setUint16(10, this.entries.length, true);
      view.setUint32(12, centralSize, true);
      view.setUint32(16, centralOffset, true);
      view.setUint16(20, 0, true);
    });
    this.parts.push(endRecord);
    return new Blob(this.parts, { type: "application/zip" });
  }
}
