import LastfmSection from "../sections/integrations/LastfmSection";
import { useIntegrations } from "./context";

export default function LastfmIntegrationPage() {
  const { fields, updateField } = useIntegrations();

  return (
    <LastfmSection
      apiKey={fields.lastfmApiKey}
      onApiKeyChange={(v) => updateField("lastfmApiKey", v)}
    />
  );
}
