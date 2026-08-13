import { useState, useCallback, useEffect } from "react";
import { useSettings } from "@/context/useSettings";
import { useAutoSave } from "@/hooks/useAutoSave";
import useAutoSetupStatus from "@/hooks/useAutoSetupStatus";
import LidarrConnectionSection from "../sections/integrations/LidarrConnectionSection";
import LidarrOptionsSection from "../sections/integrations/LidarrOptionsSection";
import LastfmSection from "../sections/integrations/LastfmSection";
import PlexSection from "../sections/integrations/PlexSection";
import SlskdSection from "../sections/integrations/SlskdSection";
import ImportSection from "../sections/integrations/ImportSection";
import AutoSetupModal from "../shared/AutoSetupModal";
import Skeleton from "@/components/Skeleton";
import SaveStatusIndicator from "../shared/SaveStatusIndicator";

type TestResult = {
  success: boolean;
  version?: string;
  error?: string;
};

type SlskdTestResult = {
  success: boolean;
  version?: string | null;
  soulseekConnected?: boolean;
  error?: string;
};

function slskdBannerClass(result: SlskdTestResult): string {
  if (!result.success) return "bg-rose-400 text-white";
  if (!result.soulseekConnected) return "bg-amber-300 text-black";
  return "bg-emerald-400 text-black";
}

function slskdBannerText(result: SlskdTestResult): string {
  if (!result.success) return `Connection failed: ${result.error}`;
  const version = result.version ? ` v${result.version}` : "";
  if (!result.soulseekConnected) {
    return `Reached slskd${version}, but it is not logged into the Soulseek network`;
  }
  return `Connected! slskd${version} is logged into Soulseek`;
}

export default function IntegrationsSettingsPage() {
  const {
    options,
    settings,
    isLoading,
    isConnected,
    savePartialSettings,
    testConnection,
    testSlskdConnection,
    loadLidarrOptionValues,
  } = useSettings();

  const { fields, saveStatus, saveError, updateField, updateFields } =
    useAutoSave(settings, savePartialSettings);

  const {
    status: autoSetupStatus,
    loading: autoSetupLoading,
    refetch: refetchAutoSetup,
  } = useAutoSetupStatus();

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [slskdTesting, setSlskdTesting] = useState(false);
  const [slskdTestResult, setSlskdTestResult] =
    useState<SlskdTestResult | null>(null);
  const [autoSetupModalOpen, setAutoSetupModalOpen] = useState(false);

  useEffect(() => {
    loadLidarrOptionValues();
  }, [loadLidarrOptionValues]);

  const handleTest = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setTesting(true);
      setTestResult(null);

      try {
        const result = await testConnection({
          ...fields,
          lidarrUrl: fields.lidarrUrl,
          lidarrApiKey: fields.lidarrApiKey,
        });
        setTestResult(result);
        if (result.success) {
          await loadLidarrOptionValues();
        }
      } catch (err) {
        setTestResult({
          success: false,
          error: err instanceof Error ? err.message : "Test failed",
        });
      } finally {
        setTesting(false);
      }
    },
    [fields, testConnection, loadLidarrOptionValues]
  );

  const handleTestSlskd = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setSlskdTesting(true);
      setSlskdTestResult(null);

      try {
        const result = await testSlskdConnection(fields);
        setSlskdTestResult(result);
      } catch (err) {
        setSlskdTestResult({
          success: false,
          error: err instanceof Error ? err.message : "Test failed",
        });
      } finally {
        setSlskdTesting(false);
      }
    },
    [fields, testSlskdConnection]
  );

  const handlePlexLoginComplete = useCallback(
    (serverUrl: string) => {
      updateFields({ plexUrl: serverUrl });
    },
    [updateFields]
  );

  const handlePlexSignOut = useCallback(() => {
    updateFields({ plexUrl: "" });
  }, [updateFields]);

  const handleAutoSetupSuccess = useCallback(() => {
    refetchAutoSetup();
  }, [refetchAutoSetup]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="space-y-4">
            <Skeleton className="h-6 w-48" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SaveStatusIndicator status={saveStatus} error={saveError} />
      </div>

      <LidarrConnectionSection
        url={fields.lidarrUrl}
        apiKey={fields.lidarrApiKey}
        testing={testing}
        onUrlChange={(v) => updateField("lidarrUrl", v)}
        onApiKeyChange={(v) => updateField("lidarrApiKey", v)}
        onTest={handleTest}
      />

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

      <LastfmSection
        apiKey={fields.lastfmApiKey}
        onApiKeyChange={(v) => updateField("lastfmApiKey", v)}
      />

      <PlexSection
        url={fields.plexUrl}
        onUrlChange={(v) => updateField("plexUrl", v)}
        onSignOut={handlePlexSignOut}
        onLoginComplete={handlePlexLoginComplete}
      />

      <SlskdSection
        url={fields.slskdUrl}
        apiKey={fields.slskdApiKey}
        downloadPath={fields.slskdDownloadPath}
        testing={slskdTesting}
        onUrlChange={(v) => updateField("slskdUrl", v)}
        onApiKeyChange={(v) => updateField("slskdApiKey", v)}
        onDownloadPathChange={(v) => updateField("slskdDownloadPath", v)}
        onTest={handleTestSlskd}
        isConnected={isConnected}
        autoSetupStatus={autoSetupStatus}
        autoSetupLoading={autoSetupLoading}
        onAutoSetup={() => setAutoSetupModalOpen(true)}
      />

      <ImportSection
        importPath={fields.importPath}
        onImportPathChange={(v) => updateField("importPath", v)}
      />

      {testResult && (
        <div
          className={`mt-4 p-3 rounded-xl text-sm font-medium border-2 border-black shadow-cartoon-sm animate-slide-up ${
            testResult.success
              ? "bg-emerald-400 text-black"
              : "bg-rose-400 text-white"
          }`}
        >
          {testResult.success
            ? `Connected! Lidarr v${testResult.version}`
            : `Connection failed: ${testResult.error}`}
        </div>
      )}

      {slskdTestResult && (
        <div
          className={`mt-4 p-3 rounded-xl text-sm font-medium border-2 border-black shadow-cartoon-sm animate-slide-up ${slskdBannerClass(
            slskdTestResult
          )}`}
        >
          {slskdBannerText(slskdTestResult)}
        </div>
      )}

      <AutoSetupModal
        isOpen={autoSetupModalOpen}
        onClose={() => setAutoSetupModalOpen(false)}
        onSuccess={handleAutoSetupSuccess}
      />
    </div>
  );
}
