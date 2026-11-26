import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import TaskDetail from './pages/TaskDetail';
import AdminUsers from './pages/AdminUsers';
import AdminProjects from './pages/AdminProjects';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Sprints from './pages/Sprints';
import Releases from './pages/Releases';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import AssignmentResponse from './pages/AssignmentResponse';
import Layout from './components/Layout';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#64748b' }}>Loading...</div>;
  return user ? children : <Navigate to="/login" />;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (!['super_admin', 'admin'].includes(user.role)) return <Navigate to="/" />;
  return children;
}

function ProjectManagerRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (!['super_admin', 'admin', 'manager'].includes(user.role)) return <Navigate to="/" />;
  return children;
}

function LegacyIssueRedirect() {
  const location = useLocation();
  const suffix = location.pathname.replace(/^\/issues\/?/, '') ;
  return <Navigate to={`/tasks${suffix ? `/${suffix}` : ''}${location.search}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/assignment-response" element={<AssignmentResponse />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="tasks/:id" element={<TaskDetail />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="issues" element={<LegacyIssueRedirect />} />
            <Route path="issues/*" element={<LegacyIssueRedirect />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<AdminRoute><Settings /></AdminRoute>} />
            <Route path="sprints" element={<Sprints />} />
            <Route path="releases" element={<Releases />} />
            <Route path="admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
            <Route path="admin/projects" element={<ProjectManagerRoute><AdminProjects /></ProjectManagerRoute>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
