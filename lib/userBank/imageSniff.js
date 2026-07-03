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

module.exports = { sniffImageMime };
