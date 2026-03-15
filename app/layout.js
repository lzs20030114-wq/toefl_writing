import "./mobile.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://treepractice.com";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TreePractice — AI 英语写作练习 | 适用于 TOEFL® 备考",
    template: "%s | TreePractice",
  },
  description:
    "TreePractice 提供 AI 驱动的英语写作练习与即时评分反馈，涵盖学术讨论、邮件写作、造句三大题型，适用于 TOEFL® 写作备考。免费开始练习。",
  keywords: [
    "TOEFL写作", "托福写作练习", "TOEFL writing practice",
    "AI写作评分", "英语写作练习", "托福备考",
    "TOEFL iBT writing", "学术写作", "TreePractice",
  ],
  authors: [{ name: "TreePractice" }],
  openGraph: {
    type: "website",
    siteName: "TreePractice",
    title: "TreePractice — AI 英语写作练习",
    description: "AI 即时评分，三大题型全覆盖，适用于 TOEFL® 写作备考。免费开始练习。",
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    title: "TreePractice — AI 英语写作练习",
    description: "AI 即时评分，三大题型全覆盖，适用于 TOEFL® 写作备考。",
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: {
    google: "c0UlJ1BYULLR_fQmC3I05BKTc1KuWstn79_9Tmfb4IE",
  },
  alternates: {
    canonical: SITE_URL,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "TreePractice",
  url: SITE_URL,
  description: "AI 驱动的英语写作练习与即时评分，适用于 TOEFL® 写作备考",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "CNY",
    description: "免费用户每日 3 次练习",
  },
  featureList: [
    "学术讨论写作 (Task 1)",
    "邮件写作 (Task 2)",
    "造句排列 (Task 3)",
    "AI 即时评分与反馈",
    "模拟考试模式",
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;700&display=swap" rel="stylesheet" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
