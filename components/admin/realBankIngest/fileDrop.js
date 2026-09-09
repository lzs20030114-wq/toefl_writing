"use client";
/**
 * 拖入整个文件夹 → 带相对路径的文件清单。
 *
 * 真题源是一个目录（PDF/docx + 一堆逐题 mp3，常有子目录），录入管线靠**相对路径**
 * 认文件（哪个是答案、哪段音频配哪题），所以不能只取 file.name。
 * 三条来源都要支持：
 *   - 拖拽目录 → DataTransferItem.webkitGetAsEntry() 递归（Chrome/Edge/Safari 都有）
 *   - <input webkitdirectory> → file.webkitRelativePath
 *   - 多选文件 → 退化成文件名
 */

const MAX_ENTRIES = 2000; // 递归兜底：拖进来一个巨大目录时别把浏览器卡死

function entryFiles(entry, prefix, out) {
  return new Promise((resolve) => {
    if (out.length > MAX_ENTRIES) return resolve();
    if (entry.isFile) {
      entry.file(
        (file) => {
          out.push({ file, path: prefix ? `${prefix}/${file.name}` : file.name });
          resolve();
        },
        () => resolve()
      );
      return;
    }
    if (!entry.isDirectory) return resolve();
    const reader = entry.createReader();
    const kids = [];
    const readBatch = () => {
      reader.readEntries(
        async (batch) => {
          if (!batch.length) {
            const next = prefix ? `${prefix}/${entry.name}` : entry.name;
            for (const k of kids) await entryFiles(k, next, out);
            return resolve();
          }
          kids.push(...batch);
          readBatch(); // readEntries 每次最多回 100 条，必须读到空数组为止
        },
        () => resolve()
      );
    };
    readBatch();
  });
}

/** @returns {Promise<Array<{file:File,path:string}>>} */
export async function collectFromDataTransfer(dt) {
  const items = Array.from(dt?.items || []);
  const entries = items
    .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (entries.length) {
    const out = [];
    for (const e of entries) await entryFiles(e, "", out);
    if (out.length) return out;
  }
  return Array.from(dt?.files || []).map((file) => ({ file, path: file.name }));
}

/** <input type=file [webkitdirectory]> 的 FileList → 同样形状。 */
export function collectFromInput(fileList) {
  return Array.from(fileList || []).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

/** 去掉 webkitdirectory 带来的最外层目录名，让相对路径以套内结构为准。 */
export function stripCommonRoot(items) {
  if (items.length < 2) return items;
  const roots = new Set(items.map((i) => (i.path.includes("/") ? i.path.split("/")[0] : null)));
  if (roots.size !== 1 || roots.has(null)) return items;
  const root = [...roots][0];
  return items.map((i) => ({ ...i, path: i.path.slice(root.length + 1) }));
}

export function formatBytes(n) {
  if (n == null) return "--";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
