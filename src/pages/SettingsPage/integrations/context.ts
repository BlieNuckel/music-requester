import { useOutletContext } from "react-router-dom";
import type { AppSettings, LidarrOptions } from "@/context/settingsContextDef";

export type LidarrTestResult = {
  success: boolean;
  version?: string;
  error?: string;
};

export type SlskdTestResult = {
  success: boolean;
  version?: string | null;
  soulseekConnected?: boolean;
  error?: string;
};

export type AutoSetupStatus = {
  indexerExists: boolean;
  downloadClientExists: boolean;
} | null;

export type TestHandler = (e: React.MouseEvent<HTMLButtonElement>) => void;

export type ConnectionTest<TResult> = {
  testing: boolean;
  result: TResult | null;
  run: TestHandler;
};

/**
 * Everything the integration groups share. It lives on the parent rather than in
 * each group so a debounced edit and a test result survive switching tabs, and so
 * one save indicator covers the whole page.
 */
export type IntegrationsContext = {
  fields: AppSettings;
  updateField: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => void;
  updateFields: (partial: Partial<AppSettings>) => void;
  options: LidarrOptions;
  isConnected: boolean;
  lidarrTest: ConnectionTest<LidarrTestResult>;
  slskdTest: ConnectionTest<SlskdTestResult>;
  autoSetup: {
    status: AutoSetupStatus;
    loading: boolean;
    /** Re-read whether the indexer and download client exist in Lidarr yet. */
    refetch: () => void;
  };
};

export function useIntegrations(): IntegrationsContext {
  return useOutletContext<IntegrationsContext>();
}
