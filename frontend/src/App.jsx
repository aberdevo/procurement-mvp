import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Shell from './components/Shell.jsx';
import Login from './pages/Login.jsx';
import Requests from './pages/Requests.jsx';
import RequestForm from './pages/RequestForm.jsx';
import RequestDetail from './pages/RequestDetail.jsx';
import Vendors from './pages/Vendors.jsx';
import Audit from './pages/Audit.jsx';
import Admin from './pages/Admin.jsx';

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="boot">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function RoleGate({ roles, children }) {
  const { user } = useAuth();
  return roles.includes(user.role) ? children : <Navigate to="/requests" replace />;
}

export default function App() {
  const { user, ready } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={ready && user ? <Navigate to="/requests" replace /> : <Login />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/requests" replace />} />
        <Route path="/requests" element={<Requests />} />
        <Route
          path="/requests/new"
          element={
            <RoleGate roles={['requester', 'manager']}>
              <RequestForm />
            </RoleGate>
          }
        />
        <Route path="/requests/:id" element={<RequestDetail />} />
        <Route path="/requests/:id/edit" element={<RequestForm />} />
        <Route
          path="/vendors"
          element={
            <RoleGate roles={['procurement', 'finance', 'admin']}>
              <Vendors />
            </RoleGate>
          }
        />
        <Route
          path="/audit"
          element={
            <RoleGate roles={['finance', 'admin']}>
              <Audit />
            </RoleGate>
          }
        />
        <Route
          path="/admin"
          element={
            <RoleGate roles={['admin']}>
              <Admin />
            </RoleGate>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/requests" replace />} />
    </Routes>
  );
}
