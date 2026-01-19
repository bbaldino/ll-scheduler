/**
 * Simple ZIP file creator for Cloudflare Workers
 * Creates uncompressed ZIP files (STORE method) which is fine for text/CSV files
 */

interface ZipEntry {
  filename: string;
  content: string;
}

/**
 * Create a ZIP file from an array of file entries
 */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const files: Array<{
    filename: Uint8Array;
    content: Uint8Array;
    crc32: number;
    offset: number;
  }> = [];

  // Calculate total size needed
  let offset = 0;
  for (const entry of entries) {
    const filename = encoder.encode(entry.filename);
    const content = encoder.encode(entry.content);
    const crc32 = crc32Calculate(content);
    files.push({ filename, content, crc32, offset });
    // Local file header (30) + filename + content
    offset += 30 + filename.length + content.length;
  }

  // Calculate central directory size
  let centralDirSize = 0;
  for (const file of files) {
    centralDirSize += 46 + file.filename.length;
  }

  // Total size: local files + central directory + end of central directory (22)
  const totalSize = offset + centralDirSize + 22;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  let pos = 0;

  // Write local file headers and content
  for (const file of files) {
    // Local file header signature
    view.setUint32(pos, 0x04034b50, true);
    pos += 4;
    // Version needed to extract
    view.setUint16(pos, 20, true);
    pos += 2;
    // General purpose bit flag
    view.setUint16(pos, 0, true);
    pos += 2;
    // Compression method (0 = store)
    view.setUint16(pos, 0, true);
    pos += 2;
    // Last mod file time
    view.setUint16(pos, 0, true);
    pos += 2;
    // Last mod file date
    view.setUint16(pos, 0, true);
    pos += 2;
    // CRC-32
    view.setUint32(pos, file.crc32, true);
    pos += 4;
    // Compressed size
    view.setUint32(pos, file.content.length, true);
    pos += 4;
    // Uncompressed size
    view.setUint32(pos, file.content.length, true);
    pos += 4;
    // Filename length
    view.setUint16(pos, file.filename.length, true);
    pos += 2;
    // Extra field length
    view.setUint16(pos, 0, true);
    pos += 2;
    // Filename
    buffer.set(file.filename, pos);
    pos += file.filename.length;
    // Content
    buffer.set(file.content, pos);
    pos += file.content.length;
  }

  const centralDirOffset = pos;

  // Write central directory
  for (const file of files) {
    // Central directory file header signature
    view.setUint32(pos, 0x02014b50, true);
    pos += 4;
    // Version made by
    view.setUint16(pos, 20, true);
    pos += 2;
    // Version needed to extract
    view.setUint16(pos, 20, true);
    pos += 2;
    // General purpose bit flag
    view.setUint16(pos, 0, true);
    pos += 2;
    // Compression method (0 = store)
    view.setUint16(pos, 0, true);
    pos += 2;
    // Last mod file time
    view.setUint16(pos, 0, true);
    pos += 2;
    // Last mod file date
    view.setUint16(pos, 0, true);
    pos += 2;
    // CRC-32
    view.setUint32(pos, file.crc32, true);
    pos += 4;
    // Compressed size
    view.setUint32(pos, file.content.length, true);
    pos += 4;
    // Uncompressed size
    view.setUint32(pos, file.content.length, true);
    pos += 4;
    // Filename length
    view.setUint16(pos, file.filename.length, true);
    pos += 2;
    // Extra field length
    view.setUint16(pos, 0, true);
    pos += 2;
    // File comment length
    view.setUint16(pos, 0, true);
    pos += 2;
    // Disk number start
    view.setUint16(pos, 0, true);
    pos += 2;
    // Internal file attributes
    view.setUint16(pos, 0, true);
    pos += 2;
    // External file attributes
    view.setUint32(pos, 0, true);
    pos += 4;
    // Relative offset of local header
    view.setUint32(pos, file.offset, true);
    pos += 4;
    // Filename
    buffer.set(file.filename, pos);
    pos += file.filename.length;
  }

  // Write end of central directory record
  // Signature
  view.setUint32(pos, 0x06054b50, true);
  pos += 4;
  // Number of this disk
  view.setUint16(pos, 0, true);
  pos += 2;
  // Disk where central directory starts
  view.setUint16(pos, 0, true);
  pos += 2;
  // Number of central directory records on this disk
  view.setUint16(pos, files.length, true);
  pos += 2;
  // Total number of central directory records
  view.setUint16(pos, files.length, true);
  pos += 2;
  // Size of central directory
  view.setUint32(pos, centralDirSize, true);
  pos += 4;
  // Offset of start of central directory
  view.setUint32(pos, centralDirOffset, true);
  pos += 4;
  // Comment length
  view.setUint16(pos, 0, true);

  return buffer;
}

/**
 * Calculate CRC-32 checksum
 */
function crc32Calculate(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Pre-computed CRC-32 lookup table
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crc32Table[i] = c;
}
