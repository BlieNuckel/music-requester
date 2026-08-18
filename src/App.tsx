import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import RequireOnboarding from "./components/RequireOnboarding";
import SearchPage from "./pages/SearchPage/SearchPage";
import ArtistPage from "./pages/ArtistPage/ArtistPage";
import AlbumPage from "./pages/AlbumPage/AlbumPage";
import DiscoverPage from "./pages/DiscoverPage/DiscoverPage";
import LibraryPage from "./pages/LibraryPage/LibraryPage";
import SettingsLayout from "./pages/SettingsPage/SettingsLayout";
import GeneralSettingsPage from "./pages/SettingsPage/pages/GeneralSettingsPage";
import IntegrationsSettingsPage from "./pages/SettingsPage/pages/IntegrationsSettingsPage";
import RecommendationsSettingsPage from "./pages/SettingsPage/pages/RecommendationsSettingsPage";
import PurchaseDecisionSettingsPage from "./pages/SettingsPage/pages/PurchaseDecisionSettingsPage";
import UsersSettingsPage from "./pages/SettingsPage/pages/UsersSettingsPage";
import LogsSettingsPage from "./pages/SettingsPage/pages/LogsSettingsPage";
import TasteProfilesSettingsPage from "./pages/SettingsPage/pages/TasteProfilesSettingsPage";
import LidarrIntegrationPage from "./pages/SettingsPage/integrations/LidarrIntegrationPage";
import SoulseekIntegrationPage from "./pages/SettingsPage/integrations/SoulseekIntegrationPage";
import PlexIntegrationPage from "./pages/SettingsPage/integrations/PlexIntegrationPage";
import LastfmIntegrationPage from "./pages/SettingsPage/integrations/LastfmIntegrationPage";
import LiveEventsIntegrationPage from "./pages/SettingsPage/integrations/LiveEventsIntegrationPage";
import NotificationsPage from "./pages/SettingsPage/notifications/NotificationsPage";
import MyNotificationsPage from "./pages/SettingsPage/notifications/MyNotificationsPage";
import EmailNotificationsPage from "./pages/SettingsPage/notifications/EmailNotificationsPage";
import WebhookNotificationsPage from "./pages/SettingsPage/notifications/WebhookNotificationsPage";
import OnboardingPage from "./pages/OnboardingPage/OnboardingPage";
import UploadPage from "./pages/LibraryPage/UploadPage";
import ConditionalRedirect from "./components/ConditionalRedirect";

function App() {
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<RequireOnboarding />}>
          <Route element={<Layout />}>
            <Route path="/" element={<DiscoverPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/artist/:mbid" element={<ArtistPage />} />
            <Route path="/album/:mbid" element={<AlbumPage />} />
            <Route path="/library/upload" element={<UploadPage />} />
            <Route path="/library" element={<LibraryPage />}>
              <Route
                index
                element={<ConditionalRedirect to="/library/purchases" />}
              />
              <Route path="purchases" element={null} />
              <Route path="wanted" element={null} />
              <Route path="requests" element={null} />
              <Route path="following" element={null} />
              <Route path="live" element={null} />
            </Route>
            <Route path="/settings" element={<SettingsLayout />}>
              <Route
                index
                element={<ConditionalRedirect to="/settings/general" />}
              />
              <Route path="general" element={<GeneralSettingsPage />} />
              <Route path="integrations" element={<IntegrationsSettingsPage />}>
                <Route
                  index
                  element={
                    <ConditionalRedirect to="/settings/integrations/lidarr" />
                  }
                />
                <Route path="lidarr" element={<LidarrIntegrationPage />} />
                <Route path="soulseek" element={<SoulseekIntegrationPage />} />
                <Route path="plex" element={<PlexIntegrationPage />} />
                <Route path="lastfm" element={<LastfmIntegrationPage />} />
                <Route
                  path="live-events"
                  element={<LiveEventsIntegrationPage />}
                />
              </Route>
              <Route
                path="recommendations"
                element={<RecommendationsSettingsPage />}
              />
              <Route
                path="purchase-decision"
                element={<PurchaseDecisionSettingsPage />}
              />
              <Route path="users" element={<UsersSettingsPage />} />
              <Route path="logs" element={<LogsSettingsPage />} />
              <Route
                path="taste-profiles"
                element={<TasteProfilesSettingsPage />}
              />
              <Route path="notifications" element={<NotificationsPage />}>
                <Route
                  index
                  element={
                    <ConditionalRedirect to="/settings/notifications/mine" />
                  }
                />
                <Route path="mine" element={<MyNotificationsPage />} />
                <Route path="email" element={<EmailNotificationsPage />} />
                <Route path="webhook" element={<WebhookNotificationsPage />} />
              </Route>
            </Route>
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
