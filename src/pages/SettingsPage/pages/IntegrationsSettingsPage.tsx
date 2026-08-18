import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useSettings } from "@/context/useSettings";
import { useAutoSave } from "@/hooks/useAutoSave";
import useAutoSetupStatus from "@/hooks/useAutoSetupStatus";
import Skeleton from "@/components/Skeleton";
import IntegrationsLayout from "../integrations/IntegrationsLayout";
import useIntegrationTests from "../integrations/useIntegrationTests";
import SaveStatusIndicator from "../shared/SaveStatusIndicator";
import type { IntegrationsContext } from "../integrations/context";

function LoadingSkeleton() {
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

/**
 * Holds the state every integration group shares and hands it to the active group
 * through the outlet. Kept here rather than per group so a debounced edit and a
 * connection test result survive switching tabs.
 */
export default function IntegrationsSettingsPage() {
  const {
    options,
    settings,
    isLoading,
    isConnected,
    savePartialSettings,
    loadLidarrOptionValues,
  } = useSettings();

  const { fields, saveStatus, saveError, updateField, updateFields } =
    useAutoSave(settings, savePartialSettings);

  const { lidarrTest, slskdTest } = useIntegrationTests(fields);

  const {
    status: autoSetupStatus,
    loading: autoSetupLoading,
    refetch: refetchAutoSetup,
  } = useAutoSetupStatus();

  useEffect(() => {
    loadLidarrOptionValues();
  }, [loadLidarrOptionValues]);

  if (isLoading) return <LoadingSkeleton />;

  const context: IntegrationsContext = {
    fields,
    updateField,
    updateFields,
    options,
    isConnected,
    lidarrTest,
    slskdTest,
    autoSetup: {
      status: autoSetupStatus,
      loading: autoSetupLoading,
      refetch: refetchAutoSetup,
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SaveStatusIndicator status={saveStatus} error={saveError} />
      </div>

      <IntegrationsLayout>
        <Outlet context={context} />
      </IntegrationsLayout>
    </div>
  );
}
