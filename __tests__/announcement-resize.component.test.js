import { render, screen, fireEvent } from "@testing-library/react";
import { AnnouncementButton } from "../components/home/AnnouncementModal";

// 公告栏可拖拽调整大小：左下角手柄拖动改宽高，松手记忆到 localStorage，双击恢复默认。
const SIZE_KEY = "toefl-announcement-size";
const HANDLE_TITLE = "拖拽调整大小，双击恢复默认";

/* jsdom 的 PointerEvent 支持不全，手动构造带坐标的事件 */
function firePointer(target, type, props) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, props);
  fireEvent(target, ev);
}

function openDropdown() {
  render(<AnnouncementButton isChallenge={false} />);
  fireEvent.click(screen.getByTitle("更新公告"));
  return screen.getByText("更新公告").parentElement; // header 的父级即面板
}

describe("公告栏拖拽调整大小", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("默认尺寸 340x420，拖动手柄后变大并写入 localStorage", () => {
    const panel = openDropdown();
    expect(panel.style.width).toBe("340px");
    expect(panel.style.height).toBe("420px");

    const handle = screen.getByTitle(HANDLE_TITLE);
    firePointer(handle, "pointerdown", { clientX: 500, clientY: 500, button: 0 });
    // 面板右锚定：向左拖 100px 变宽，向下拖 100px 变高
    firePointer(document, "pointermove", { clientX: 400, clientY: 600 });
    expect(panel.style.width).toBe("440px");
    expect(panel.style.height).toBe("520px");

    firePointer(document, "pointerup", {});
    expect(JSON.parse(localStorage.getItem(SIZE_KEY))).toEqual({ w: 440, h: 520 });
  });

  test("不能拖到比最小尺寸更小", () => {
    const panel = openDropdown();
    const handle = screen.getByTitle(HANDLE_TITLE);
    firePointer(handle, "pointerdown", { clientX: 100, clientY: 500, button: 0 });
    // 向右上方向拖很远 → 收缩到下限 280x240
    firePointer(document, "pointermove", { clientX: 900, clientY: 0 });
    expect(panel.style.width).toBe("280px");
    expect(panel.style.height).toBe("240px");
    firePointer(document, "pointerup", {});
  });

  test("重新打开时读取记忆的尺寸", () => {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: 500, h: 600 }));
    const panel = openDropdown();
    expect(panel.style.width).toBe("500px");
    expect(panel.style.height).toBe("600px");
  });

  test("双击手柄恢复默认尺寸并清除记忆", () => {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: 500, h: 600 }));
    const panel = openDropdown();
    fireEvent.doubleClick(screen.getByTitle(HANDLE_TITLE));
    expect(panel.style.width).toBe("340px");
    expect(panel.style.height).toBe("420px");
    expect(localStorage.getItem(SIZE_KEY)).toBeNull();
  });
});
