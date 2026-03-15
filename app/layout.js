export const metadata = {
  title: "TreePractice — AI 写作备考工具 | 适用于 TOEFL® 考试",
  description: "TreePractice 提供 AI 驱动的英语写作练习与评分，涵盖三类写作任务，适用于 TOEFL® 写作备考。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
