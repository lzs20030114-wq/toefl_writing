// 让 Node 直接 import lib/ 下的 ESM 源码：仓库里的 import 都不带扩展名（Next/Jest 帮补），
// 原生 ESM 不补。这里只给「相对路径、没有扩展名」的说明符补 .js。
export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?js$|\.json$/.test(specifier)) {
    try { return await next(`${specifier}.js`, context); } catch {}
  }
  return next(specifier, context);
}
