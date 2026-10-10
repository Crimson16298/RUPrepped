import { Route, Routes } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage";
import { SessionSetupPage } from "./pages/SessionSetupPage";
import { LiveInterviewPage } from "./pages/LiveInterviewPage";
import { ResultsPage } from "./pages/ResultsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/setup" element={<SessionSetupPage />} />
      <Route path="/interview" element={<LiveInterviewPage />} />
      <Route path="/results" element={<ResultsPage />} />
      <Route path="*" element={<LandingPage />} />
    </Routes>
  );
}
