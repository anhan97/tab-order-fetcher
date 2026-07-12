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
import { PendingApprovalPage } from "@/pages/PendingApprovalPage";
import { PrivacyPolicyPage } from "@/pages/PrivacyPolicyPage";
import { TermsOfServicePage } from "@/pages/TermsOfServicePage";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

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

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsOfServicePage />} />

      <Route path="/pending" element={<PendingApprovalPage />} />

      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/orders" replace />} />

        {/* Store management now lives inside the Layout so the sidebar +
            store switcher are always visible while connecting/switching. */}
        <Route path="/connect" element={
          <ProtectedRoute>
            <ConnectPage />
          </ProtectedRoute>
        } />

        <Route path="/orders" element={
          <ProtectedRoute>
            <OrdersPage />
          </ProtectedRoute>
        } />

        <Route path="/fulfillment" element={
          <ProtectedRoute>
            <FulfillmentPage />
          </ProtectedRoute>
        } />

        <Route path="/tracking" element={
          <ProtectedRoute>
            <TrackingPage />
          </ProtectedRoute>
        } />

        {/* /analytics + /profit retired — content lives under /orders tabs.
            Old bookmarks / inbound links keep working via redirect. */}
        <Route path="/analytics" element={<Navigate to="/orders" replace />} />

        <Route path="/cogs" element={
          <ProtectedRoute>
            <CogsPage />
          </ProtectedRoute>
        } />

        <Route path="/facebook" element={
          <ProtectedRoute>
            <FacebookPage />
          </ProtectedRoute>
        } />

        <Route path="/content" element={
          <ProtectedRoute>
            <ContentAnalyticsPage />
          </ProtectedRoute>
        } />

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
