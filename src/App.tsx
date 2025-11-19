import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppContextProvider, useAppContext } from "@/context/AppContext";
import { Layout } from "@/components/Layout";
import { ConnectPage } from "@/pages/ConnectPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { TrackingPage } from "@/pages/TrackingPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { CogsPage } from "@/pages/CogsPage";
import { FacebookPage } from "@/pages/FacebookPage";
import { ContentAnalyticsPage } from "@/pages/ContentAnalyticsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isShopifyConnected } = useAppContext();

  if (!isShopifyConnected) {
    return <Navigate to="/connect" replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/connect" element={<ConnectPage />} />

      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/orders" replace />} />

        <Route path="/orders" element={
          <ProtectedRoute>
            <OrdersPage />
          </ProtectedRoute>
        } />

        <Route path="/tracking" element={
          <ProtectedRoute>
            <TrackingPage />
          </ProtectedRoute>
        } />

        <Route path="/analytics" element={
          <ProtectedRoute>
            <AnalyticsPage />
          </ProtectedRoute>
        } />

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
      <AppContextProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppContextProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
