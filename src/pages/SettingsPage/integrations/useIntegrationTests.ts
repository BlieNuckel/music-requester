import { useCallback, useState } from "react";
import { useSettings } from "@/context/useSettings";
import type { AppSettings } from "@/context/settingsContextDef";
import type {
  ConnectionTest,
  LidarrTestResult,
  SlskdTestResult,
} from "./context";

function errorResult(err: unknown) {
  return {
    success: false,
    error: err instanceof Error ? err.message : "Test failed",
  };
}

/**
 * The two "test connection" buttons, kept out of the page so it stays a layout.
 * A successful Lidarr test reloads its option lists, since that is the moment the
 * profiles and root folders become knowable.
 */
export default function useIntegrationTests(fields: AppSettings): {
  lidarrTest: ConnectionTest<LidarrTestResult>;
  slskdTest: ConnectionTest<SlskdTestResult>;
} {
  const { testConnection, testSlskdConnection, loadLidarrOptionValues } =
    useSettings();

  const [lidarrTesting, setLidarrTesting] = useState(false);
  const [lidarrResult, setLidarrResult] = useState<LidarrTestResult | null>(
    null
  );
  const [slskdTesting, setSlskdTesting] = useState(false);
  const [slskdResult, setSlskdResult] = useState<SlskdTestResult | null>(null);

  const runLidarr = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setLidarrTesting(true);
      setLidarrResult(null);

      try {
        const result = await testConnection(fields);
        setLidarrResult(result);
        if (result.success) await loadLidarrOptionValues();
      } catch (err) {
        setLidarrResult(errorResult(err));
      } finally {
        setLidarrTesting(false);
      }
    },
    [fields, testConnection, loadLidarrOptionValues]
  );

  const runSlskd = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setSlskdTesting(true);
      setSlskdResult(null);

      try {
        setSlskdResult(await testSlskdConnection(fields));
      } catch (err) {
        setSlskdResult(errorResult(err));
      } finally {
        setSlskdTesting(false);
      }
    },
    [fields, testSlskdConnection]
  );

  return {
    lidarrTest: {
      testing: lidarrTesting,
      result: lidarrResult,
      run: (e) => void runLidarr(e),
    },
    slskdTest: {
      testing: slskdTesting,
      result: slskdResult,
      run: (e) => void runSlskd(e),
    },
  };
}
