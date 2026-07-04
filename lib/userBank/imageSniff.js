// 图片 magic-byte 嗅探——以文件真实字节判断类型，无视客户端 Content-Type。
// 供 /api/user-bank/extract-image 做上传校验（file-type/sharp 均未安装，手写识别，无新依赖）。

/**
 * @param {Buffer|Uint8Array} buf
 * @returns {"image/jpeg"|"image/png"|"image/webp"|null}
 */
function sniffImageMime(buf) {
  if (!buf || buf.length < 3) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png";
  // WebP: "RIFF"...."WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) return "image/webp";
  return null;
}

/**
 * 多图批量校验（/api/user-bank/extract-image 支持一次 1-3 张：AP 学术短文常跨 2-3 张截图）。
 * 逐张 magic-byte 嗅探 + 张数上限 + **合计**体积门（Vercel body ~4.5MB，合计 4MB 留余量）。
 * 单图调用天然向后兼容（长度 1 的数组）。
 *
 * @param {Array<Buffer|Uint8Array>} buffers
 * @param {{ maxCount?: number, maxTotalBytes?: number }} [opts]
 * @returns {{ ok: true, images: Array<{ buffer: Buffer|Uint8Array, mime: string }> }
 *   | { ok: false, status: number, error: string }}
 */
function validateImageBatch(buffers, { maxCount = 3, maxTotalBytes = 4 * 1024 * 1024 } = {}) {
  const list = Array.isArray(buffers) ? buffers : [];
  if (list.length === 0) return { ok: false, status: 400, error: "Missing image" };
  if (list.length > maxCount) {
    return { ok: false, status: 400, error: `一次最多上传 ${maxCount} 张图片` };
  }
  let total = 0;
  const images = [];
  for (const buf of list) {
    if (!buf || buf.length === 0) return { ok: false, status: 400, error: "Empty image" };
    total += buf.length;
    if (total > maxTotalBytes) {
      return {
        ok: false,
        status: 413,
        error: `图片合计过大（>${Math.round(maxTotalBytes / 1024 / 1024)}MB），请压缩或减少张数后重试`,
      };
    }
    const mime = sniffImageMime(buf);
    if (!mime) return { ok: false, status: 415, error: "仅支持 JPEG / PNG / WebP 图片" };
    images.push({ buffer: buf, mime });
  }
  return { ok: true, images };
}

module.exports = { sniffImageMime, validateImageBatch };
