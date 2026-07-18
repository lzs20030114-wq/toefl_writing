import PricingPreview from "../../components/pricing/PricingPreview";

export const metadata = {
  title: "Pro 新方案预览",
  robots: { index: false, follow: false },
};

export default function PricingPreviewPage({ searchParams }) {
  return (
    <PricingPreview
      initialAnnouncement={searchParams?.view === "announcement"}
      initialSection={searchParams?.section === "credits" ? "credits" : "plans"}
    />
  );
}
