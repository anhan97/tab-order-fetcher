import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppContextProvider } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { ConnectPage } from "@/pages/ConnectPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { TrackingPage } from "@/pages/TrackingPage";
// AnalyticsPage retired — /analytics now redirects to /orders (Overview tab).
// Component file kept on disk pending full deletion.
import { CogsPage } from "@/pages/CogsPage";
import { FacebookPage } from "@/pages/FacebookPage";
import { ContentAnalyticsPage } from "@/pages/ContentAnalyticsPage";
// ProfitPage retired — /profit now redirects to /orders (Daily P&L tab).
import { AdminPage } from "@/pages/AdminPage";
import { FulfillmentPage } from "@/pages/FulfillmentPage";
import { CreativesPage } from "@/features/creatives/pages/CreativesPage";
import { AdsLauncherPage } from "@/features/ads-launcher/pages/AdsLauncherPage";
import { PendingApprovalPage } from "@/pages/PendingApprovalPage";
import { PrivacyPolicyPage } from "@/pages/PrivacyPolicyPage";
import { TermsOfServicePage } from "@/pages/TermsOfServicePage";
import NotFound from "./pages/NotFound";
import { Loader2, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { storeAllowsPage, homePath, type AppRole } from "@/lib/permissions";

const queryClient = new QueryClient();

/**
 * Gate routes on real auth. Sends unauthenticated users to /login and
 * preserves the originally-requested URL so we can return them after sign-in.
 *
 * NOTE: we deliberately do NOT force users with zero stores anywhere — they
 * can browse the app freely and go to /connect (Stores) to add/switch stores
 * whenever they want. Pages that need an active store render their own empty
 * state instead. This lets one user manage many stores and switch between
 * them from the sidebar.
 */
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Approval gate: PENDING/SUSPENDED accounts only see the waiting screen.
  // The backend blocks their feature calls anyway (requireActive) — this
  // keeps the UI from rendering a wall of 403 toasts.
  if ((user.status === 'PENDING' || user.status === 'SUSPENDED') && location.pathname !== '/pending') {
    return <Navigate to="/pending" replace />;
  }

  return <>{children}</>;
};

/** "/" → the first page this user may open (a 'creative' member lands on Creatives). */
const HomeRedirect = () => {
  const { user, canInStore } = useAuth();
  return <Navigate to={homePath((user?.role || 'user') as AppRole, canInStore)} replace />;
};

/**
 * A store page the active store does not grant: say so instead of rendering a
 * page whose every call answers 403. With no active store the page renders
 * its own "pick a store" state. The server enforces the same rules.
 */
const StorePageGate = ({ path, children }: { path: string; children: React.ReactNode }) => {
  const { user, activeStore, canInStore } = useAuth();
  if (!activeStore || user?.role === 'admin' || storeAllowsPage(path, canInStore)) return <>{children}</>;
  return (
    <div className="max-w-xl mx-auto mt-8">
      <Card className="p-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <Lock className="h-6 w-6" />
        </div>
        <h2 className="mb-2 text-lg font-bold text-slate-900">No access to this page</h2>
        <p className="text-sm text-slate-600">
          Your access to <b>{activeStore.name || activeStore.storeDomain}</b> does not include this page.
          Ask an admin to grant it, or switch store in the sidebar.
        </p>
      </Card>
    </div>
  );
};

/** ProtectedRoute + StorePageGate, the wrapper every store page uses. */
const StorePage = ({ path, children }: { path: string; children: React.ReactNode }) => (
  <ProtectedRoute>
    <StorePageGate path={path}>{children}</StorePageGate>
  </ProtectedRoute>
);

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsOfServicePage />} />

      <Route path="/pending" element={<PendingApprovalPage />} />

      <Route element={<Layout />}>
        <Route path="/" element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />

        {/* Store management now lives inside the Layout so the sidebar +
            store switcher are always visible while connecting/switching. */}
        <Route path="/connect" element={
          <ProtectedRoute>
            <ConnectPage />
          </ProtectedRoute>
        } />

        <Route path="/orders" element={<StorePage path="/orders"><OrdersPage /></StorePage>} />

        <Route path="/fulfillment" element={<StorePage path="/fulfillment"><FulfillmentPage /></StorePage>} />

        <Route path="/tracking" element={<StorePage path="/tracking"><TrackingPage /></StorePage>} />

        {/* /analytics + /profit retired — content lives under /orders tabs.
            Old bookmarks / inbound links keep working via redirect. */}
        <Route path="/analytics" element={<Navigate to="/orders" replace />} />

        <Route path="/cogs" element={<StorePage path="/cogs"><CogsPage /></StorePage>} />

        <Route path="/facebook" element={<StorePage path="/facebook"><FacebookPage /></StorePage>} />

        <Route path="/creatives" element={<StorePage path="/creatives"><CreativesPage /></StorePage>} />

        <Route path="/ads-launcher" element={<StorePage path="/ads-launcher"><AdsLauncherPage /></StorePage>} />

        <Route path="/content" element={<StorePage path="/content"><ContentAnalyticsPage /></StorePage>} />

        <Route path="/profit" element={<Navigate to="/orders" replace />} />

        <Route path="/admin" element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppContextProvider>
            <AppRoutes />
          </AppContextProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
