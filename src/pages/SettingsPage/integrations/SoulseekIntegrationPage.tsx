import { useState } from "react";
import SlskdSection from "../sections/integrations/SlskdSection";
import AutoSetupModal from "../shared/AutoSetupModal";
import ConnectionResultBanner from "./ConnectionResultBanner";
import { useIntegrations } from "./context";
import type { SlskdTestResult } from "./context";

function bannerTone(result: SlskdTestResult): "success" | "warning" | "error" {
  if (!result.success) return "error";
  return result.soulseekConnected ? "success" : "warning";
}

function bannerText(result: SlskdTestResult): string {
  if (!result.success) return `Connection failed: ${result.error}`;
  const version = result.version ? ` v${result.version}` : "";
  if (!result.soulseekConnected) {
    return `Reached slskd${version}, but it is not logged into the Soulseek network`;
  }
  return `Connected! slskd${version} is logged into Soulseek`;
}

export default function SoulseekIntegrationPage() {
  const { fields, updateField, isConnected, slskdTest, autoSetup } =
    useIntegrations();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="space-y-6">
      <SlskdSection
        url={fields.slskdUrl}
        apiKey={fields.slskdApiKey}
        downloadPath={fields.slskdDownloadPath}
        indexerApiKey={fields.torznabApiKey}
        testing={slskdTest.testing}
        onUrlChange={(v) => updateField("slskdUrl", v)}
        onApiKeyChange={(v) => updateField("slskdApiKey", v)}
        onDownloadPathChange={(v) => updateField("slskdDownloadPath", v)}
        onIndexerApiKeyChange={(v) => updateField("torznabApiKey", v)}
        onTest={slskdTest.run}
        isConnected={isConnected}
        autoSetupStatus={autoSetup.status}
        autoSetupLoading={autoSetup.loading}
        onAutoSetup={() => setModalOpen(true)}
      />

      {slskdTest.result && (
        <ConnectionResultBanner tone={bannerTone(slskdTest.result)}>
          {bannerText(slskdTest.result)}
        </ConnectionResultBanner>
      )}

      <AutoSetupModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={autoSetup.refetch}
      />
    </div>
  );
}
