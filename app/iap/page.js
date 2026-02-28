import { notFound } from "next/navigation";
import IapWorkspaceClient from "../../components/iap/IapWorkspaceClient";
import { isIapEnabledServer } from "../../lib/featureFlags";

export const metadata = {
  title: "In-App Purchase Setup",
  description: "IAP setup staging page",
};

export default function IapPage() {
  if (!isIapEnabledServer()) {
    notFound();
  }

  return <IapWorkspaceClient />;
}
