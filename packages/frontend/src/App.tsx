import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import SeasonsPage from './pages/SeasonsPage';
import DivisionsPage from './pages/DivisionsPage';
import FieldsPage from './pages/FieldsPage';
import TeamsPage from './pages/TeamsPage';
import BattingCagesPage from './pages/BattingCagesPage';
import ScheduledEventsPage from './pages/ScheduledEventsPage';
import { SeasonProvider } from './contexts/SeasonContext';

function App() {
  return (
    <SeasonProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/seasons" replace />} />
          <Route path="seasons" element={<SeasonsPage />} />
          <Route path="divisions" element={<DivisionsPage />} />
          <Route path="fields" element={<FieldsPage />} />
          <Route path="batting-cages" element={<BattingCagesPage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="events" element={<ScheduledEventsPage />} />
        </Route>
      </Routes>
    </SeasonProvider>
  );
}

export default App;
