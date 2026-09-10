import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AgentChat } from "./pages/AgentChat";
import { Dashboard } from "./pages/Dashboard";
import { LandingPage } from "./pages/LandingPage";
import "./App.css";

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/agent"
        element={
          <ProtectedRoute>
            <AgentChat />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;
