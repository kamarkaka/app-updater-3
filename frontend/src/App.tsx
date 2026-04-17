import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Dashboard from "./pages/Dashboard";
import AppForm from "./pages/AppForm";
import AppDetail from "./pages/AppDetail";
import Downloads from "./pages/Downloads";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route
          path="/"
          element={
            <Layout>
              <Dashboard />
            </Layout>
          }
        />
        <Route
          path="/apps/new"
          element={
            <Layout>
              <AppForm />
            </Layout>
          }
        />
        <Route
          path="/apps/:id"
          element={
            <Layout>
              <AppDetail />
            </Layout>
          }
        />
        <Route
          path="/apps/:id/edit"
          element={
            <Layout>
              <AppForm />
            </Layout>
          }
        />
        <Route
          path="/downloads"
          element={
            <Layout>
              <Downloads />
            </Layout>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
