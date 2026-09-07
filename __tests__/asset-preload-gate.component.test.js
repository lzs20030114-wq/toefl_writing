import { render, screen, fireEvent, act } from "@testing-library/react";
import { AssetPreloadGate } from "../components/shared/AssetPreloadGate";
import { materialImagePreloadUrls } from "../lib/reading/materialImage";

/**
 * 题目素材预加载门（components/shared/AssetPreloadGate.js）的契约：
 *   - 没图 → 原样透传 children，不出加载页；
 *   - 有图 → 先出加载页，全部 load / error 后才渲染 children；
 *   - 超时强制放行；换题重来一轮；加载页「返回」走 onExit。
 */
const A = "/api/img/reading/a.webp";
const B = "/api/img/reading/b.webp";

function Child() {
  return <div data-testid="child">child</div>;
}

describe("AssetPreloadGate", () => {
  test("images 为空 → 直接渲染 children，没有加载页", () => {
    render(<AssetPreloadGate images={[]}><Child /></AssetPreloadGate>);
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.queryByTestId("asset-preload-gate")).toBeNull();
  });

  test("有图 → 先出加载页 + 进度，全部 load 后才渲染 children", () => {
    render(
      <AssetPreloadGate images={[A, B, A]} title="日常阅读真题" section="真题专区">
        <Child />
      </AssetPreloadGate>
    );
    expect(screen.getByTestId("asset-preload-gate")).toBeTruthy();
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByText("正在加载题目材料")).toBeTruthy();
    // 去重后只预热两张
    const imgs = screen.getAllByTestId("asset-preload-img");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([A, B]);
    expect(screen.getByTestId("asset-preload-progress").textContent).toBe("0 / 2");

    fireEvent.load(imgs[0]);
    expect(screen.getByTestId("asset-preload-progress").textContent).toBe("1 / 2");
    expect(screen.queryByTestId("child")).toBeNull();

    fireEvent.load(imgs[1]);
    expect(screen.queryByTestId("asset-preload-gate")).toBeNull();
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  test("图片 error 也算结束（坏图不锁死用户，RDLTask 自带切换文字兜底）", () => {
    render(<AssetPreloadGate images={[A]}><Child /></AssetPreloadGate>);
    fireEvent.error(screen.getByTestId("asset-preload-img"));
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  test("超时强制放行", () => {
    jest.useFakeTimers();
    try {
      render(<AssetPreloadGate images={[A]} timeoutMs={3000}><Child /></AssetPreloadGate>);
      expect(screen.queryByTestId("child")).toBeNull();
      act(() => { jest.advanceTimersByTime(2999); });
      expect(screen.queryByTestId("child")).toBeNull();
      act(() => { jest.advanceTimersByTime(1); });
      expect(screen.getByTestId("child")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  test("加载页的「返回」调用 onExit", () => {
    const onExit = jest.fn();
    render(<AssetPreloadGate images={[A]} onExit={onExit}><Child /></AssetPreloadGate>);
    fireEvent.click(screen.getByText("返回"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("换题（images 变化）→ 重新进入加载页", () => {
    const { rerender } = render(<AssetPreloadGate images={[A]}><Child /></AssetPreloadGate>);
    fireEvent.load(screen.getByTestId("asset-preload-img"));
    expect(screen.getByTestId("child")).toBeTruthy();

    rerender(<AssetPreloadGate images={[B]}><Child /></AssetPreloadGate>);
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByTestId("asset-preload-img").getAttribute("src")).toBe(B);

    fireEvent.load(screen.getByTestId("asset-preload-img"));
    expect(screen.getByTestId("child")).toBeTruthy();
  });
});

describe("materialImagePreloadUrls", () => {
  test("有 material_image → 一条同源代理地址；没有 → 空数组", () => {
    const item = {
      material_image: { url: "https://abc123.supabase.co/storage/v1/object/public/real_bank_images/reading/x.webp" },
    };
    expect(materialImagePreloadUrls(item)).toEqual(["/api/img/reading/x.webp"]);
    expect(materialImagePreloadUrls({})).toEqual([]);
    expect(materialImagePreloadUrls(null)).toEqual([]);
  });
});
