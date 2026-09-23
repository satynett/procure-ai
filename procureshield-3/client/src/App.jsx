import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useApp } from "./store.jsx";
import Layout from "./components/Layout.jsx";
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import BidVerification from "./pages/BidVerification.jsx";
import BidDetail from "./pages/BidDetail.jsx";
import BidderNetwork from "./pages/BidderNetwork.jsx";
import RiskAnalysis from "./pages/RiskAnalysis.jsx";
import Alerts from "./pages/Alerts.jsx";
import Reports from "./pages/Reports.jsx";
import Settings from "./pages/Settings.jsx";
import BidIntelligence from "./pages/BidIntelligence.jsx";
import BidderPortal from "./pages/BidderPortal.jsx";
import OfficerPortal from "./pages/OfficerPortal.jsx";

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useApp();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/bidder" element={<BidderPortal />} />
      <Route path="/bidder/documents" element={<BidIntelligence />} />

      <Route path="/app/bid-intelligence" element={<ProtectedRoute><BidIntelligence /></ProtectedRoute>} />
      <Route path="/app/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/app/officer" element={<ProtectedRoute><OfficerPortal /></ProtectedRoute>} />
      <Route path="/app/bid-verification" element={<ProtectedRoute><BidVerification /></ProtectedRoute>} />
      <Route path="/app/bid-verification/:bidId" element={<ProtectedRoute><BidDetail /></ProtectedRoute>} />
      <Route path="/app/bidder-network" element={<ProtectedRoute><BidderNetwork /></ProtectedRoute>} />
      <Route path="/app/risk-analysis" element={<ProtectedRoute><RiskAnalysis /></ProtectedRoute>} />
      <Route path="/app/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
      <Route path="/app/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
      <Route path="/app/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
