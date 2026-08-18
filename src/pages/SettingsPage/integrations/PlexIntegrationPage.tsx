import PlexSection from "../sections/integrations/PlexSection";
import { useIntegrations } from "./context";

export default function PlexIntegrationPage() {
  const { fields, updateField, updateFields } = useIntegrations();

  return (
    <PlexSection
      url={fields.plexUrl}
      onUrlChange={(v) => updateField("plexUrl", v)}
      onSignOut={() => updateFields({ plexUrl: "" })}
      onLoginComplete={(serverUrl) => updateFields({ plexUrl: serverUrl })}
    />
  );
}
