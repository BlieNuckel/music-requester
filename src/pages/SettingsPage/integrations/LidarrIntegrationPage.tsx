import LidarrConnectionSection from "../sections/integrations/LidarrConnectionSection";
import LidarrOptionsSection from "../sections/integrations/LidarrOptionsSection";
import ImportSection from "../sections/integrations/ImportSection";
import ConnectionResultBanner from "./ConnectionResultBanner";
import { useIntegrations } from "./context";

export default function LidarrIntegrationPage() {
  const { fields, updateField, options, lidarrTest } = useIntegrations();

  return (
    <div className="space-y-6">
      <LidarrConnectionSection
        url={fields.lidarrUrl}
        apiKey={fields.lidarrApiKey}
        testing={lidarrTest.testing}
        onUrlChange={(v) => updateField("lidarrUrl", v)}
        onApiKeyChange={(v) => updateField("lidarrApiKey", v)}
        onTest={lidarrTest.run}
      />

      {lidarrTest.result && (
        <ConnectionResultBanner
          tone={lidarrTest.result.success ? "success" : "error"}
        >
          {lidarrTest.result.success
            ? `Connected! Lidarr v${lidarrTest.result.version}`
            : `Connection failed: ${lidarrTest.result.error}`}
        </ConnectionResultBanner>
      )}

      <LidarrOptionsSection
        rootFolders={options.rootFolderPaths}
        rootFolderPath={fields.lidarrRootFolderPath}
        qualityProfiles={options.qualityProfiles}
        qualityProfileId={fields.lidarrQualityProfileId}
        metadataProfiles={options.metadataProfiles}
        metadataProfileId={fields.lidarrMetadataProfileId}
        onRootFolderChange={(v) => updateField("lidarrRootFolderPath", v)}
        onQualityProfileChange={(v) => updateField("lidarrQualityProfileId", v)}
        onMetadataProfileChange={(v) =>
          updateField("lidarrMetadataProfileId", v)
        }
      />

      <ImportSection
        importPath={fields.importPath}
        onImportPathChange={(v) => updateField("importPath", v)}
      />
    </div>
  );
}
