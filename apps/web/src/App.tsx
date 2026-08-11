import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { Dashboard } from "@/routes/Dashboard";
import { Login } from "@/routes/Login";
import { Docker } from "@/routes/Docker";
import { Nginx } from "@/routes/Nginx";
import { Sites } from "@/routes/Sites";
import { OsSystem } from "@/routes/OsSystem";
import { Pm2 } from "@/routes/Pm2";
import { NetworkSecurity } from "@/routes/NetworkSecurity";
import { Security } from "@/routes/Security";
import { Backups } from "@/routes/Backups";
import { Restore } from "@/routes/Restore";
import { Applications } from "@/routes/Applications";
import { System } from "@/routes/System";
import { Services } from "@/routes/Services";
import { Settings } from "@/routes/Settings";
import { About } from "@/routes/About";
import { Help } from "@/routes/Help";
import { externalRoutes } from "@/routes/external";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/docker" element={<Docker />} />
          <Route path="/nginx" element={<Nginx />} />
          <Route path="/sites" element={<Sites />} />
          <Route path="/os" element={<OsSystem />} />
          <Route path="/pm2" element={<Pm2 />} />
          <Route path="/network" element={<NetworkSecurity />} />
          <Route path="/security" element={<Security />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/backups" element={<Backups />} />
          <Route path="/restore" element={<Restore />} />
          <Route path="/system" element={<System />} />
          <Route path="/services" element={<Services />} />
          <Route path="/help" element={<Help />} />
          <Route path="/about" element={<About />} />
          <Route path="/settings" element={<Settings />} />
          {externalRoutes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
