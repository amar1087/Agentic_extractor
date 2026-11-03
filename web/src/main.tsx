import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout, Me } from "./components/Layout";
import { Loading, ToastProvider } from "./components/ui";
import "./index.css";
import { api } from "./lib/api";
import { LiveProvider } from "./lib/live";
import { InvoicesPage } from "./pages/Invoices";
import { LoginPage } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { RemindersPage } from "./pages/Reminders";
import { ReviewPage } from "./pages/Review";
import { RunsPage } from "./pages/Runs";
import { SettingsPage } from "./pages/Settings";
import { VendorsPage } from "./pages/Vendors";

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const loadMe = () => api<Me>("/auth/me").then(setMe).catch(() => setMe(null));
  useEffect(() => {
    loadMe();
    const onUnauthorized = () => setMe(null);
    window.addEventListener("ae:unauthorized", onUnauthorized);
    return () => window.removeEventListener("ae:unauthorized", onUnauthorized);
  }, []);

  if (me === undefined) return <Loading />;
  if (me === null) return <LoginPage onLogin={loadMe} />;

  return (
    <LiveProvider>
      <Layout me={me}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunsPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/review/:jobId" element={<ReviewPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoicesPage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/vendors" element={<VendorsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<OverviewPage />} />
        </Routes>
      </Layout>
    </LiveProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
