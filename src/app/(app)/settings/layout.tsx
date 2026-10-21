import type { ReactNode } from "react";
import { SettingsTabs } from "@/components/client/settings-tabs";
import { PageHeader } from "@/components/ui";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" description="Configure how WeddingFlow AI works for your studio." />
      <SettingsTabs />
      {children}
    </>
  );
}
