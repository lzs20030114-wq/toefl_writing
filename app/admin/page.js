"use client";
import Link from "next/link";
import { C, FONT } from "../../components/shared/ui";

const CARDS = [
  {
    title: "登录码管理",
    desc: "生成、发放、吊销登录码，查看登录码状态与库存。",
    href: "/admin-codes",
  },
  {
    title: "用户答题情况",
    desc: "按登录码查看作答数量、答案内容和评分情况，支持默认折叠展开查看。",
    href: "/admin-activity",
  },
  {
    title: "API 失败反馈",
    desc: "查看 DeepSeek/API 错误日志、状态码分布和错误类型趋势。",
    href: "/admin-api-errors",
  },
];

export default function AdminHomePage() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, padding: 20 }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.nav, marginBottom: 8 }}>管理员后台</div>
          <div style={{ fontSize: 13, color: C.t2 }}>
            集中管理登录码、用户答题情况与 API 稳定性。请先确认 `ADMIN_DASHBOARD_TOKEN` 与 Supabase 服务端环境变量已配置。
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {CARDS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                background: "#fff",
                border: "1px solid " + C.bdr,
                borderRadius: 8,
                padding: 16,
                textDecoration: "none",
                color: C.t1,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: C.nav }}>{item.title}</div>
              <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.6 }}>{item.desc}</div>
              <div style={{ fontSize: 13, color: C.blue, fontWeight: 700 }}>进入管理 -&gt;</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
